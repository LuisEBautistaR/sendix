/** Run history: past collection runs in sendix.db, to look at again, repeat or export. */
import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { IpcChannels } from "@shared/ipc";
import { resultFailed, type RunConfig, type RunItemResult, type RunRecord, type RunSummary } from "@shared/runner";
import { isTrustedSender } from "./security";

/** Runs kept per database; older ones are dropped. */
const MAX_RUNS = 50;
/** Rows kept per run; a bigger run keeps its first rows and is marked truncated. */
const MAX_STORED_RESULTS = 5_000;
/** Data files bigger than this are not kept: repeating such a run asks for the file again. */
const MAX_STORED_DATA_CHARS = 1_000_000;

interface Row {
  id: number;
  started_at: number;
  finished_at: number;
  collection_id: string;
  collection_name: string;
  folder_name: string | null;
  iterations: number;
  requests: number;
  failed: number;
  tests_passed: number;
  tests_failed: number;
  state: RunSummary["state"];
  config_json: string;
  results_json: string;
  truncated: number;
}

export interface FinishedRun {
  startedAt: number;
  finishedAt: number;
  collectionName: string;
  folderName: string | null;
  requests: number;
  config: RunConfig;
  results: RunItemResult[];
  state: RunSummary["state"];
}

const summaryOf = (row: Row): RunSummary => ({
  id: row.id,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  collectionId: row.collection_id,
  collectionName: row.collection_name,
  folderName: row.folder_name,
  iterations: row.iterations,
  requests: row.requests,
  failed: row.failed,
  testsPassed: row.tests_passed,
  testsFailed: row.tests_failed,
  state: row.state,
});

export class RunStore {
  readonly #db: DatabaseSync;

  constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at      INTEGER NOT NULL,
        finished_at     INTEGER NOT NULL,
        collection_id   TEXT    NOT NULL,
        collection_name TEXT    NOT NULL,
        folder_name     TEXT,
        iterations      INTEGER NOT NULL,
        requests        INTEGER NOT NULL,
        failed          INTEGER NOT NULL,
        tests_passed    INTEGER NOT NULL,
        tests_failed    INTEGER NOT NULL,
        state           TEXT    NOT NULL,
        config_json     TEXT    NOT NULL,
        results_json    TEXT    NOT NULL,
        truncated       INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS runs_collection ON runs (collection_id, started_at DESC);
    `);
  }

  add(run: FinishedRun): number {
    const tests = run.results.flatMap((r) => r.tests).filter((t) => !t.skipped);
    // Responses kept for the session are not written to disk; logs are, as part of the results.
    const results = run.results.slice(0, MAX_STORED_RESULTS).map(({ response: _response, ...rest }) => rest);
    const keepData = run.config.data !== null && JSON.stringify(run.config.data).length <= MAX_STORED_DATA_CHARS;
    const config: RunConfig = { ...run.config, data: keepData ? run.config.data : null };
    const result = this.#db
      .prepare(
        `INSERT INTO runs (started_at, finished_at, collection_id, collection_name, folder_name, iterations, requests, failed, tests_passed, tests_failed, state, config_json, results_json, truncated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.startedAt,
        run.finishedAt,
        run.config.collectionId,
        run.collectionName,
        run.folderName,
        run.config.iterations,
        run.requests,
        run.results.filter(resultFailed).length,
        tests.filter((t) => t.passed).length,
        tests.filter((t) => !t.passed).length,
        run.state,
        JSON.stringify(config),
        JSON.stringify(results),
        run.results.length > MAX_STORED_RESULTS ? 1 : 0,
      );
    this.#db.prepare(`DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY started_at DESC, id DESC LIMIT ?)`).run(MAX_RUNS);
    return Number(result.lastInsertRowid);
  }

  list(collectionId: string): RunSummary[] {
    const rows = this.#db.prepare(`SELECT * FROM runs WHERE collection_id = ? ORDER BY started_at DESC, id DESC`).all(collectionId) as unknown as Row[];
    return rows.map(summaryOf);
  }

  get(id: number): RunRecord | null {
    const row = this.#db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as unknown as Row | undefined;
    if (!row) return null;
    return { ...summaryOf(row), config: JSON.parse(row.config_json) as RunConfig, results: JSON.parse(row.results_json) as RunItemResult[], truncated: row.truncated === 1 };
  }

  delete(id: number): void {
    this.#db.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  }

  close(): void {
    this.#db.close();
  }

  register(appVersion: string): void {
    const validId = (id: unknown): id is number => typeof id === "number" && Number.isInteger(id) && id > 0;
    ipcMain.handle(IpcChannels.runsList, (event, collectionId: unknown): RunSummary[] | null =>
      isTrustedSender(event.senderFrame) && typeof collectionId === "string" ? this.list(collectionId) : null,
    );
    ipcMain.handle(IpcChannels.runsGet, (event, id: unknown): RunRecord | null => (isTrustedSender(event.senderFrame) && validId(id) ? this.get(id) : null));
    ipcMain.handle(IpcChannels.runsDelete, (event, id: unknown): boolean => {
      if (!isTrustedSender(event.senderFrame) || !validId(id)) return false;
      this.delete(id);
      return true;
    });
    ipcMain.handle(IpcChannels.runsExport, async (event, id: unknown): Promise<"saved" | "cancelled" | "missing"> => {
      if (!isTrustedSender(event.senderFrame) || !validId(id)) return "missing";
      const run = this.get(id);
      if (!run) return "missing";
      const stamp = new Date(run.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const name = `ejecucion-${run.collectionName.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60)}-${stamp}.json`;
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { title: "Exportar la ejecución", defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] };
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return "cancelled";
      const { data: _data, ...config } = run.config;
      const report = {
        sendix: appVersion,
        collection: run.collectionName,
        folder: run.folderName,
        startedAt: new Date(run.startedAt).toISOString(),
        finishedAt: new Date(run.finishedAt).toISOString(),
        state: run.state,
        summary: { iterations: run.iterations, requests: run.requests, failed: run.failed, testsPassed: run.testsPassed, testsFailed: run.testsFailed },
        config: { ...config, dataRows: run.config.data?.length ?? null },
        truncated: run.truncated,
        results: run.results,
      };
      await writeFile(picked.filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return "saved";
    });
  }
}

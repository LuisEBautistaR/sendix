/**
 * Collection runner. Main walks the collection (or one folder) and sends each
 * request through the engine in order, so every send gets the same context as
 * a manual one and what scripts set carries over to the next request.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { BrowserWindow, ipcMain } from "electron";
import { ErrorCodes, type Outcome } from "@shared/rpc";
import { IpcChannels } from "@shared/ipc";
import type { TreeNode } from "@shared/collection";
import type { HttpResponse } from "@shared/http";
import { resultFailed, runConfigSchema, type DataRow, type KeptResponse, type RunConfig, type RunEvent, type RunItemResult } from "@shared/runner";
import type { EngineHost } from "./engine-host";
import type { WorkspaceController } from "./workspace/controller";
import type { PrefsService } from "./prefs";
import type { RunStore } from "./runs";
import { isTrustedSender } from "./security";

const HTTP_CALL_SLACK_MS = 10_000;
/** Body kept per row with keepResponses. */
const MAX_KEPT_BODY = 256 * 1024;

interface ActiveRun {
  id: string;
  stopped: boolean;
  currentRequestId: string | null;
  /** The run's own cookie jar in the engine (isolated cookies), or null for the shared one. */
  jar: string | null;
}

/** Request ids of a subtree, depth first, in the order they appear in the collection. */
export function requestOrder(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "request" ? [n.id] : requestOrder(n.children ?? [])));
}

/** The requests to run: all of them in collection order, or the chosen ones in the chosen order (unknown ids are dropped). */
export function runItems(available: readonly string[], chosen: readonly string[] | null): string[] {
  if (!chosen) return [...available];
  const known = new Set(available);
  return [...new Set(chosen)].filter((id) => known.has(id));
}

function findNode(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children ?? [], id);
    if (found) return found;
  }
  return null;
}

function keep(response: HttpResponse): KeptResponse {
  const bytes = response.body.subarray(0, MAX_KEPT_BODY);
  return { headers: response.headers, body: new TextDecoder("utf-8").decode(bytes), truncated: response.body.byteLength > MAX_KEPT_BODY };
}

export class RunnerController {
  #active: ActiveRun | null = null;

  constructor(
    private readonly engine: EngineHost,
    private readonly workspaces: WorkspaceController,
    private readonly prefs: PrefsService,
    private readonly runs: RunStore,
  ) {}

  register(): void {
    ipcMain.handle(IpcChannels.runnerStart, (event, config: unknown): Outcome<{ runId: string }> => {
      if (!isTrustedSender(event.senderFrame)) return { ok: false, error: { code: ErrorCodes.forbidden, message: "Untrusted sender" } };
      const parsed = runConfigSchema.safeParse(config);
      if (!parsed.success) return { ok: false, error: { code: ErrorCodes.invalidParams, message: parsed.error.message } };
      if (this.#active) return { ok: false, error: { code: "RUNNER_BUSY", message: "Ya hay una ejecución en curso" } };
      const ws = this.workspaces.workspace;
      const collection = ws?.snapshot().collections.find((c) => c.id === parsed.data.collectionId);
      if (!collection) return { ok: false, error: { code: "NOT_FOUND", message: "La colección ya no existe" } };
      const root = parsed.data.folderId ? findNode(collection.tree, parsed.data.folderId) : null;
      if (parsed.data.folderId && !root) return { ok: false, error: { code: "NOT_FOUND", message: "La carpeta ya no existe" } };
      const items = runItems(requestOrder(root ? (root.children ?? []) : collection.tree), parsed.data.itemIds);
      if (!items.length) return { ok: false, error: { code: "EMPTY", message: "No hay peticiones que ejecutar" } };

      const id = randomUUID();
      const run: ActiveRun = { id, stopped: false, currentRequestId: null, jar: parsed.data.options.cookies === "isolated" ? `run-${id}` : null };
      this.#active = run;
      void this.#run(run, parsed.data, items, collection.name, root?.name ?? null);
      return { ok: true, value: { runId: run.id } };
    });

    ipcMain.handle(IpcChannels.runnerStop, (event, runId: unknown): boolean => {
      if (!isTrustedSender(event.senderFrame)) return false;
      const run = this.#active;
      if (!run || run.id !== runId) return false;
      run.stopped = true;
      if (run.currentRequestId) void this.engine.call("http.cancel", { requestId: run.currentRequestId });
      return true;
    });
  }

  #emit(event: RunEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IpcChannels.runnerEvent, event);
    }
  }

  async #run(run: ActiveRun, config: RunConfig, items: string[], collectionName: string, folderName: string | null): Promise<void> {
    const startedAt = Date.now();
    this.#emit({ type: "started", runId: run.id, requests: items.length, iterations: config.iterations });
    let error: string | null = null;
    let stoppedOnError = false;
    let persisted: number | null = null;
    let recordId: number | null = null;
    const results: RunItemResult[] = [];
    let sequence = 0;
    try {
      outer: for (let iteration = 0; iteration < config.iterations && !run.stopped; iteration++) {
        const data = config.data?.length ? (config.data[Math.min(iteration, config.data.length - 1)] ?? null) : null;
        for (const itemId of items) {
          if (run.stopped) break;
          if (sequence > 0 && config.delayMs > 0) await sleep(config.delayMs);
          if (run.stopped) break;
          const result = await this.#send(run, config, itemId, iteration, sequence++, data);
          if (!result) continue;
          results.push(result);
          this.#emit({ type: "item", runId: run.id, result });
          if (config.options.stopOnError && resultFailed(result) && !run.stopped) {
            stoppedOnError = true;
            break outer;
          }
        }
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      this.#active = null;
      if (run.jar) await this.engine.call("http.dropJar", { jar: run.jar, keep: config.options.saveCookies }).catch(() => undefined);
      if (config.options.persistVariables && !error) {
        try {
          persisted = await this.workspaces.persistSession(config.collectionId);
        } catch (err) {
          error = `No se pudieron guardar las variables: ${(err as Error).message}`;
        }
      }
      try {
        recordId = this.runs.add({
          startedAt,
          finishedAt: Date.now(),
          collectionName,
          folderName,
          requests: items.length,
          config,
          results,
          state: error ? "error" : run.stopped || stoppedOnError ? "stopped" : "finished",
        });
      } catch (err) {
        console.error("[main] Could not save the run", err);
      }
      this.#emit({ type: "finished", runId: run.id, stopped: run.stopped || stoppedOnError, error, stoppedOnError, persisted, recordId });
    }
  }

  async #send(run: ActiveRun, config: RunConfig, itemId: string, iteration: number, sequence: number, data: DataRow | null): Promise<RunItemResult | null> {
    const ws = this.workspaces.workspace;
    if (!ws) throw new Error("Se cerró la carpeta de trabajo");
    const { collectionId, options } = config;
    const source = { collectionId, itemId };
    let view;
    try {
      view = ws.getItem(source);
    } catch {
      return null; // Removed while the run was going: skip it.
    }
    const requestId = `run-${randomUUID()}`;
    run.currentRequestId = requestId;
    const startedAt = Date.now();
    // Saved requests do not store a timeout: they run with the one from Settings.
    const timeoutMs = this.prefs.prefs.request.timeoutMs;
    const prepared = await this.prefs.prepare({ ...view.request, settings: { ...view.request.settings, timeoutMs } });
    const outcome = await this.engine.call(
      "http.send",
      { requestId, ...prepared, source, context: this.workspaces.contextFor(source), iterationData: data, cookieJar: run.jar },
      timeoutMs + HTTP_CALL_SLACK_MS,
    );
    run.currentRequestId = null;

    const base = {
      iteration: iteration + 1,
      sequence,
      itemId,
      name: view.name,
      path: view.path,
      method: view.request.method.toUpperCase(),
      url: view.request.url,
    };
    if (!outcome.ok) {
      return { ...base, status: null, statusText: null, error: outcome.error.code, message: outcome.error.message, durationMs: Date.now() - startedAt, sizeBytes: 0, tests: [], errors: [], console: [] };
    }
    const value = outcome.value;
    if (value.session) this.workspaces.applySession(value.session, collectionId);
    const scripts = value.kind === "cancelled" ? undefined : value.scripts;
    const report = { tests: scripts?.tests ?? [], errors: scripts?.errors ?? [], console: options.logs ? (scripts?.console ?? []) : [] };
    if (value.kind === "response") {
      const r = value.response;
      return {
        ...base,
        url: r.sent.url,
        status: r.status,
        statusText: r.statusText,
        error: null,
        message: null,
        durationMs: Math.round(r.timings.total),
        sizeBytes: r.sizes.body,
        ...report,
        ...(options.keepResponses ? { response: keep(r) } : {}),
      };
    }
    if (value.kind === "cancelled") return { ...base, status: null, statusText: null, error: "CANCELLED", message: null, durationMs: value.elapsedMs, sizeBytes: 0, ...report };
    return { ...base, status: null, statusText: null, error: value.code, message: value.message, durationMs: value.elapsedMs, sizeBytes: 0, ...report };
  }
}

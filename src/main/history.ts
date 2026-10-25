/**
 * Request history, kept by main in SQLite (node:sqlite, built into Electron's Node).
 * Stores the request and a summary of its outcome, never response bodies.
 * Secrets are redacted before they reach the disk: auth values and the values of
 * credential-bearing headers are blanked and the entry is marked as redacted.
 */
import { DatabaseSync } from "node:sqlite";
import type { HttpOutcome, HttpRequest, KeyValue } from "@shared/http";
import type { HistoryEntry } from "@shared/ipc";

const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key", "api-key", "x-auth-token"]);
const MAX_ENTRIES = 1_000;

export function redactRequest(request: HttpRequest): { request: HttpRequest; redacted: boolean } {
  let redacted = false;
  const scrub = (rows: KeyValue[]) =>
    rows.map((row) => {
      if (SENSITIVE_HEADERS.has(row.key.trim().toLowerCase()) && row.value !== "") {
        redacted = true;
        return { ...row, value: "" };
      }
      return row;
    });

  let auth = request.auth;
  switch (auth.type) {
    case "bearer":
      if (auth.token) (redacted = true), (auth = { ...auth, token: "" });
      break;
    case "basic":
      if (auth.password) (redacted = true), (auth = { ...auth, password: "" });
      break;
    case "apikey":
      if (auth.value) (redacted = true), (auth = { ...auth, value: "" });
      break;
    case "preserved":
      // OAuth tokens, AWS keys…: never stored.
      if (auth.data != null) (redacted = true), (auth = { ...auth, data: null });
      break;
  }
  return { request: { ...request, headers: scrub(request.headers), auth }, redacted };
}

interface Row {
  id: number;
  at: number;
  method: string;
  url: string;
  status: number | null;
  status_text: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  error: string | null;
  redacted: number;
  request_json: string;
}

export class HistoryStore {
  readonly #db: DatabaseSync;

  constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        at           INTEGER NOT NULL,
        method       TEXT    NOT NULL,
        url          TEXT    NOT NULL,
        status       INTEGER,
        status_text  TEXT,
        duration_ms  REAL,
        size_bytes   INTEGER,
        error        TEXT,
        redacted     INTEGER NOT NULL DEFAULT 0,
        request_json TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_at ON history (at DESC);
    `);
  }

  add(original: HttpRequest, outcome: HttpOutcome, at = Date.now()): HistoryEntry {
    const { request, redacted } = redactRequest(original);
    const response = outcome.kind === "response" ? outcome.response : null;
    const error = outcome.kind === "error" ? outcome.code : outcome.kind === "cancelled" ? "CANCELLED" : null;
    const duration = outcome.kind === "response" ? outcome.response.timings.total : outcome.elapsedMs;
    const result = this.#db
      .prepare(
        `INSERT INTO history (at, method, url, status, status_text, duration_ms, size_bytes, error, redacted, request_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        request.method.toUpperCase(),
        request.url,
        response?.status ?? null,
        response?.statusText ?? null,
        duration,
        response ? response.sizes.body : null,
        error,
        redacted ? 1 : 0,
        JSON.stringify(request),
      );
    this.#db.prepare(`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY at DESC, id DESC LIMIT ?)`).run(MAX_ENTRIES);
    return this.get(Number(result.lastInsertRowid))!;
  }

  list(limit = 200): HistoryEntry[] {
    const rows = this.#db.prepare(`SELECT * FROM history ORDER BY at DESC, id DESC LIMIT ?`).all(limit) as unknown as Row[];
    return rows.map(toEntry);
  }

  get(id: number): HistoryEntry | null {
    const row = this.#db.prepare(`SELECT * FROM history WHERE id = ?`).get(id) as unknown as Row | undefined;
    return row ? toEntry(row) : null;
  }

  clear(): void {
    this.#db.exec(`DELETE FROM history`);
  }

  close(): void {
    this.#db.close();
  }
}

function toEntry(row: Row): HistoryEntry {
  return {
    id: row.id,
    at: row.at,
    method: row.method,
    url: row.url,
    status: row.status,
    statusText: row.status_text,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
    error: row.error,
    redacted: row.redacted === 1,
    request: JSON.parse(row.request_json) as HttpRequest,
  };
}

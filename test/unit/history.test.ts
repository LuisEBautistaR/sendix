import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryStore, redactRequest } from "../../src/main/history";
import { DEFAULT_SETTINGS, type HttpOutcome, type HttpRequest } from "@shared/http";

const dirs: string[] = [];
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), "sendix-history-"));
  dirs.push(dir);
  return new HistoryStore(join(dir, "test.db"));
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const request: HttpRequest = {
  method: "get",
  url: "https://api.example.test/items",
  headers: [
    { key: "Authorization", value: "Bearer secret", enabled: true },
    { key: "Accept", value: "application/json", enabled: true },
  ],
  body: { mode: "none" },
  auth: { type: "bearer", token: "secret-token" },
  settings: DEFAULT_SETTINGS,
};

const ok: HttpOutcome = {
  kind: "response",
  response: {
    status: 200,
    statusText: "OK",
    headers: [],
    cookies: [],
    body: new Uint8Array([1, 2, 3]),
    sizes: { body: 3, headers: 40 },
    timings: { dns: 0, tcp: 0, tls: 0, wait: 10, download: 2, redirects: 0, total: 12 },
    redirectCount: 0,
    sent: { method: "GET", url: "https://api.example.test/items", headers: [] },
  },
};

describe("history", () => {
  it("never stores credentials", () => {
    const { request: clean, redacted } = redactRequest(request);
    expect(redacted).toBe(true);
    expect(clean.auth).toEqual({ type: "bearer", token: "" });
    expect(clean.headers).toEqual([
      { key: "Authorization", value: "", enabled: true },
      { key: "Accept", value: "application/json", enabled: true },
    ]);
    expect(redactRequest({ ...request, headers: [], auth: { type: "none" } }).redacted).toBe(false);
  });

  it("stores a summary of responses and errors, newest first", () => {
    const db = store();
    db.add(request, ok, 1_000);
    db.add({ ...request, url: "https://down.example.test" }, { kind: "error", code: "ECONNREFUSED", message: "x", elapsedMs: 5 }, 2_000);
    const [latest, first] = db.list();
    expect(latest).toMatchObject({ url: "https://down.example.test", status: null, error: "ECONNREFUSED", durationMs: 5, method: "GET" });
    expect(first).toMatchObject({ status: 200, statusText: "OK", durationMs: 12, sizeBytes: 3, error: null, redacted: true });
    expect(first!.request.auth).toEqual({ type: "bearer", token: "" });
    db.close();
  });

  it("clears everything", () => {
    const db = store();
    db.add(request, ok);
    db.clear();
    expect(db.list()).toEqual([]);
    db.close();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RunStore } from "../../src/main/runs";
import { runItems } from "../../src/main/runner";
import { Workspace, type SecretStore } from "../../src/main/workspace/workspace";
import { DEFAULT_RUN_OPTIONS, type RunConfig, type RunItemResult } from "@shared/runner";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sendix-runs-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const config = (patch: Partial<RunConfig> = {}): RunConfig => ({
  collectionId: "c1",
  folderId: null,
  itemIds: null,
  iterations: 1,
  delayMs: 0,
  data: null,
  dataName: null,
  options: { ...DEFAULT_RUN_OPTIONS },
  ...patch,
});

const result = (sequence: number, patch: Partial<RunItemResult> = {}): RunItemResult => ({
  iteration: 1,
  sequence,
  itemId: `r${sequence}`,
  name: `Petición ${sequence}`,
  path: [],
  method: "GET",
  url: "http://127.0.0.1/x",
  status: 200,
  statusText: "OK",
  error: null,
  message: null,
  durationMs: 5,
  sizeBytes: 10,
  tests: [{ name: "ok", passed: true, skipped: false, error: null }],
  errors: [],
  console: [],
  ...patch,
});

describe("runItems", () => {
  it("runs everything in collection order by default", () => {
    expect(runItems(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
  });
  it("keeps the chosen order and drops unknown or repeated ids", () => {
    expect(runItems(["a", "b", "c"], ["c", "x", "a", "c"])).toEqual(["c", "a"]);
  });
});

describe("RunStore", () => {
  it("keeps summaries and full records, without the kept responses", () => {
    const store = new RunStore(join(tempDir(), "sendix.db"));
    const id = store.add({
      startedAt: 1_000,
      finishedAt: 1_500,
      collectionName: "Tienda",
      folderName: null,
      requests: 2,
      config: config({ data: [{ categoria: "te" }], dataName: "datos.csv" }),
      results: [result(0, { response: { headers: [], body: "{}", truncated: false } }), result(1, { status: 500, tests: [{ name: "200", passed: false, skipped: false, error: "esperaba 200" }] })],
      state: "finished",
    });
    expect(store.list("c1")).toEqual([
      expect.objectContaining({ id, collectionName: "Tienda", requests: 2, failed: 1, testsPassed: 1, testsFailed: 1, state: "finished", startedAt: 1_000, finishedAt: 1_500 }),
    ]);
    expect(store.list("otra")).toEqual([]);
    const record = store.get(id)!;
    expect(record.results).toHaveLength(2);
    expect(record.results[0]!.response).toBeUndefined();
    expect(record.config.data).toEqual([{ categoria: "te" }]);
    store.delete(id);
    expect(store.get(id)).toBeNull();
    store.close();
  });

  it("does not keep big data files", () => {
    const store = new RunStore(join(tempDir(), "sendix.db"));
    const rows = Array.from({ length: 2_000 }, (_, i) => ({ texto: "x".repeat(600), i }));
    const id = store.add({ startedAt: 1, finishedAt: 2, collectionName: "T", folderName: null, requests: 1, config: config({ data: rows, dataName: "grande.json" }), results: [], state: "stopped" });
    const record = store.get(id)!;
    expect(record.config.data).toBeNull();
    expect(record.config.dataName).toBe("grande.json");
    store.close();
  });
});

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  get(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

describe("Workspace.persistSession", () => {
  it("writes what scripts set into the files and keeps secrets encrypted", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "collections"));
    copyFileSync(resolve(import.meta.dirname, "../fixtures/tienda.postman_collection.json"), join(dir, "collections", "Tienda.postman_collection.json"));
    const secrets = new MemorySecrets();
    let n = 0;
    const ws = await Workspace.open(dir, { secrets, newId: () => `gen-${++n}` });
    const col = ws.snapshot().collections[0]!;
    const envId = await ws.createEnvironment("Dev");
    await ws.saveEnvironment(envId, "Dev", [
      { key: "token", value: "viejo", enabled: true, secret: true, keepSecret: false },
      { key: "usuario", value: "ana", enabled: true, secret: false, keepSecret: false },
      { key: "borrar", value: "x", enabled: true, secret: false, keepSecret: false },
    ]);
    ws.setActiveEnvironment(envId);

    ws.applySession({ environment: [{ key: "token", value: "nuevo" }, { key: "usuario", value: "luis" }, { key: "borrar", value: null }, { key: "extra", value: "1" }], collection: [{ key: "categoria", value: "te" }] }, col.id);
    expect(await ws.persistSession(col.id)).toBe(5);
    expect(ws.hasSessionValues).toBe(false);

    const envFile = join(dir, "environments", "Dev.postman_environment.json");
    const env = JSON.parse(readFileSync(envFile, "utf8"));
    expect(env.values).toEqual([
      { key: "token", value: "", type: "secret", enabled: true },
      { key: "usuario", value: "luis", type: "default", enabled: true },
      { key: "extra", value: "1", type: "default", enabled: true },
    ]);
    expect([...secrets.values.values()]).toEqual(["nuevo"]);
    const saved = JSON.parse(readFileSync(join(dir, "collections", "Tienda.postman_collection.json"), "utf8"));
    expect(saved.variable.find((v: { key: string }) => v.key === "categoria").value).toBe("te");
  });
});

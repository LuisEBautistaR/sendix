import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Workspace, slug, type SecretStore } from "../../src/main/workspace/workspace";
import { DEFAULT_SETTINGS } from "@shared/http";

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

const dirs: string[] = [];
let n = 0;
const deps = (secrets = new MemorySecrets()) => ({ secrets, newId: () => `gen-${++n}` });
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sendix-ws-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const fixture = resolve(import.meta.dirname, "../fixtures/tienda.postman_collection.json");
const withFixture = () => {
  const dir = tempDir();
  mkdirSync(join(dir, "collections"));
  copyFileSync(fixture, join(dir, "collections", "Tienda.postman_collection.json"));
  return dir;
};
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("workspace folder", () => {
  it("creates the manifest and folders in an empty directory", async () => {
    const dir = tempDir();
    const ws = await Workspace.open(dir, deps());
    expect(readdirSync(dir).sort()).toEqual(["collections", "environments", "sendix.workspace.json"]);
    expect(readJson(join(dir, "sendix.workspace.json"))).toMatchObject({ id: ws.id, version: 1 });
    expect(ws.snapshot()).toMatchObject({ collections: [], environments: [], problems: [] });
  });

  it("loads collections, adds missing ids once and reports unreadable files", async () => {
    const dir = withFixture();
    writeFileSync(join(dir, "collections", "roto.json"), "{ esto no es json");
    const ws = await Workspace.open(dir, deps());
    const snap = ws.snapshot();
    expect(snap.collections).toHaveLength(1);
    expect(snap.collections[0]).toMatchObject({ name: "Tienda demo", file: "Tienda.postman_collection.json" });
    expect(snap.problems).toEqual([{ file: join("collections", "roto.json"), reason: expect.stringContaining("No se pudo leer") }]);

    const saved = readJson(join(dir, "collections", "Tienda.postman_collection.json"));
    expect(saved.item[0].id).toBeTruthy();
    const firstIds = JSON.stringify(saved);
    await Workspace.open(dir, deps());
    expect(JSON.stringify(readJson(join(dir, "collections", "Tienda.postman_collection.json")))).toBe(firstIds);
  });

  it("edits a request in place and keeps the rest of the file", async () => {
    const dir = withFixture();
    const ws = await Workspace.open(dir, deps());
    const col = ws.snapshot().collections[0]!;
    const listId = col.tree[0]!.children![0]!.id;
    const view = ws.getItem({ collectionId: col.id, itemId: listId });
    expect(view).toMatchObject({ name: "Listar productos", path: ["Productos"] });

    await ws.saveItem({ collectionId: col.id, itemId: listId }, { ...view.request, method: "HEAD" }, view.disabledParams);
    const saved = readJson(join(dir, "collections", "Tienda.postman_collection.json"));
    expect(saved.item[0].item[0].request.method).toBe("HEAD");
    expect(saved.item[0].item[0].event[0].listen).toBe("test");
    expect(saved.event[0].listen).toBe("prerequest");
  });

  it("creates collections, folders and requests with readable file names", async () => {
    const dir = tempDir();
    const ws = await Workspace.open(dir, deps());
    const id = await ws.createCollection("Pagos: México/2026");
    const folder = await ws.createFolder(id, null, "Tarjetas");
    await ws.createRequest(id, folder, "Cobrar", { method: "POST", url: "https://pagos.test/cobros", headers: [], body: { mode: "none" }, auth: { type: "inherit" }, settings: DEFAULT_SETTINGS }, []);
    expect(readdirSync(join(dir, "collections"))).toEqual(["Pagos México2026.postman_collection.json"]);
    expect(ws.snapshot().collections[0]!.tree).toMatchObject([{ name: "Tarjetas", kind: "folder", children: [{ name: "Cobrar", method: "POST" }] }]);

    const again = await ws.createCollection("Pagos: México/2026");
    expect(again).not.toBe(id);
    expect(readdirSync(join(dir, "collections")).sort()).toEqual(["Pagos México2026 2.postman_collection.json", "Pagos México2026.postman_collection.json"]);
    await ws.deleteCollection(again);
    expect(readdirSync(join(dir, "collections"))).toHaveLength(1);
  });

  it("keeps secret values out of the folder and resolves them only for sending", async () => {
    const dir = withFixture();
    const secrets = new MemorySecrets();
    const ws = await Workspace.open(dir, deps(secrets));
    const envId = await ws.createEnvironment("Desarrollo");
    await ws.saveEnvironment(envId, "Desarrollo", [
      { key: "base", value: "http://localhost:3000", enabled: true, secret: false, keepSecret: false },
      { key: "token", value: "tok-super-secreto", enabled: true, secret: true, keepSecret: false },
    ]);
    const file = readdirSync(join(dir, "environments"))[0]!;
    const onDisk = readFileSync(join(dir, "environments", file), "utf8");
    expect(onDisk).not.toContain("tok-super-secreto");
    expect(JSON.parse(onDisk).values[1]).toEqual({ key: "token", value: "", type: "secret", enabled: true });

    expect(ws.getEnvironment(envId).rows[1]).toEqual({ key: "token", value: "", enabled: true, secret: true, hasValue: true });

    // Saving again without retyping the secret keeps it.
    await ws.saveEnvironment(envId, "Dev", [{ key: "token", value: "", enabled: true, secret: true, keepSecret: true }]);
    ws.setActiveEnvironment(envId);
    const col = ws.snapshot().collections[0]!;
    const listId = col.tree[0]!.children![0]!.id;
    const ctx = ws.contextFor({ collectionId: col.id, itemId: listId });
    expect(ctx.environment).toEqual([{ key: "token", value: "tok-super-secreto", enabled: true, secret: true }]);
    expect(ctx.authChain.map((a) => a?.["type"] ?? null)).toEqual(["bearer", "apikey"]);
    expect(ctx.collectionVariables.map((v) => v.key)).toEqual(["base", "categoria", "viejo"]);

    expect(ws.variablesFor(col.id)).toEqual([
      { key: "token", value: null, secret: true, source: "entorno" },
      { key: "base", value: "http://127.0.0.1:9", secret: false, source: "colección" },
      { key: "categoria", value: "cafe", secret: false, source: "colección" },
    ]);

    await ws.deleteEnvironment(envId);
    expect(secrets.values.size).toBe(0);
    expect(ws.snapshot().activeEnvironmentId).toBeNull();
  });

  it("keeps values set by scripts for the session only, over the files", async () => {
    const dir = withFixture();
    const ws = await Workspace.open(dir, deps());
    const col = ws.snapshot().collections[0]!;
    const file = join(dir, "collections", "Tienda.postman_collection.json");
    const onDisk = readFileSync(file, "utf8");

    ws.applySession({ environment: [{ key: "token", value: "de-script" }], collection: [{ key: "categoria", value: "te" }, { key: "base", value: null }] }, col.id);
    expect(ws.hasSessionValues).toBe(true);
    expect(ws.snapshot().sessionValues).toBe(true);
    const listId = col.tree[0]!.children![0]!.id;
    const ctx = ws.contextFor({ collectionId: col.id, itemId: listId });
    expect(ctx.environment).toEqual([{ key: "token", value: "de-script", enabled: true, secret: false }]);
    expect(ctx.collectionVariables.map((v) => [v.key, v.value])).toEqual([
      ["categoria", "te"],
      ["viejo", "x"],
    ]);
    expect(ws.variablesFor(col.id)).toEqual([
      { key: "token", value: "de-script", secret: false, source: "sesión" },
      { key: "categoria", value: "te", secret: false, source: "sesión" },
    ]);
    // Nothing reaches the files, and another environment does not see the values.
    expect(readFileSync(file, "utf8")).toBe(onDisk);
    const envId = await ws.createEnvironment("Otro");
    ws.setActiveEnvironment(envId);
    expect(ws.contextFor(null)!.environment).toEqual([]);

    ws.clearSession();
    expect(ws.hasSessionValues).toBe(false);
    ws.setActiveEnvironment(null);
    expect(ws.contextFor(null)!.environment).toEqual([]);
  });

  it("moves secret values found in imported environments to the store", async () => {
    const secrets = new MemorySecrets();
    const ws = await Workspace.open(tempDir(), deps(secrets));
    const id = await ws.addEnvironment({ name: "Importado", values: [{ key: "clave", value: "k-123", type: "secret", enabled: true }] });
    expect(ws.getEnvironment(id).rows).toEqual([{ key: "clave", value: "", enabled: true, secret: true, hasValue: true }]);
    expect([...secrets.values.values()]).toEqual(["k-123"]);
  });

  it("makes file names safe on every OS", () => {
    expect(slug(' Tienda: "API" v2? ')).toBe("Tienda API v2");
    expect(slug("con.punto.")).toBe("con.punto");
    expect(slug("***")).toBe("sin-nombre");
  });
});

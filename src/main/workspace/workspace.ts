/**
 * A workspace is a folder the user owns:
 *
 *   sendix.workspace.json                     id, name, format version
 *   collections/<name>.postman_collection.json
 *   environments/<name>.postman_environment.json
 *
 * Collections and environments are standard Postman v2.1 files, so the folder can
 * be versioned with git and opened by other tools. Secret environment values are
 * never written to the folder: they live encrypted in the app's own store.
 * No Electron imports here, so the whole class runs in unit tests.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  applyGrpc,
  applyRealtime,
  applyRequest,
  authChainFor,
  behaviorChainFor,
  collectionId,
  collectionName,
  collectionVariables,
  duplicateItem,
  eventChainFor,
  ensureIds,
  findItem,
  findPath,
  grpcFromItem,
  grpcPaths,
  insertItem,
  isFolder,
  isRealtimeItem,
  itemToRequest,
  newCollection,
  newFolder,
  newGrpcItem,
  newRealtimeItem,
  newRequestItem,
  realtimeFromItem,
  removeItem,
  renameItem,
  tree,
  type Json,
} from "@shared/collection";
import type { HttpRequest, KeyValue, RequestSource, SendContext, SessionChanges } from "@shared/http";
import type { RealtimeRequest } from "@shared/realtime";
import type { GrpcRequest } from "@shared/grpc";
import type {
  CollectionSummary,
  EnvironmentRowInput,
  EnvironmentSummary,
  EnvironmentView,
  ItemView,
  VariableView,
  WorkspaceSnapshot,
} from "@shared/workspace";

export const MANIFEST = "sendix.workspace.json";
const COLLECTIONS = "collections";
const ENVIRONMENTS = "environments";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface SecretStore {
  get(key: string): string | undefined;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkspaceDeps {
  secrets: SecretStore;
  newId: () => string;
}

export class WorkspaceError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

interface Loaded {
  file: string;
  json: Json;
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** File-name-safe slug that keeps accents readable. */
export function slug(name: string): string {
  const s = name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return s.slice(0, 80) || "sin-nombre";
}

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

const serialize = (json: unknown) => `${JSON.stringify(json, null, 2)}\n`;

export class Workspace {
  readonly path: string;
  #id = "";
  #name = "";
  #collections = new Map<string, Loaded>();
  #environments = new Map<string, Loaded>();
  #problems: Array<{ file: string; reason: string }> = [];
  #activeEnvironmentId: string | null = null;
  #writes = new Map<string, Promise<void>>();
  /**
   * Values set by scripts (pm.environment.set, pm.collectionVariables.set) during this
   * session. They override the files while the app runs and are never written to disk,
   * so a login script's token does not end up in git. null = unset by a script.
   */
  #session = { environment: new Map<string, Map<string, string | null>>(), collection: new Map<string, Map<string, string | null>>() };
  readonly #deps: WorkspaceDeps;

  private constructor(path: string, deps: WorkspaceDeps) {
    this.path = path;
    this.#deps = deps;
  }

  /** Opens a folder as a workspace, creating the manifest and subfolders when missing. */
  static async open(path: string, deps: WorkspaceDeps): Promise<Workspace> {
    const ws = new Workspace(path, deps);
    await ws.#load();
    return ws;
  }

  get id(): string {
    return this.#id;
  }

  async #load(): Promise<void> {
    await mkdir(join(this.path, COLLECTIONS), { recursive: true });
    await mkdir(join(this.path, ENVIRONMENTS), { recursive: true });
    const manifestFile = join(this.path, MANIFEST);
    let manifest: Json | null = null;
    try {
      const parsed: unknown = JSON.parse(await readFile(manifestFile, "utf8"));
      if (isObject(parsed)) manifest = parsed;
    } catch {
      /* new workspace */
    }
    if (!manifest || typeof manifest["id"] !== "string") {
      manifest = { id: this.#deps.newId(), name: basename(this.path), version: 1, ...(manifest ?? {}) };
      await writeAtomic(manifestFile, serialize(manifest));
    }
    this.#id = manifest["id"] as string;
    this.#name = typeof manifest["name"] === "string" ? manifest["name"] : basename(this.path);

    for (const file of await this.#jsonFiles(COLLECTIONS)) {
      const json = await this.#readJson(join(COLLECTIONS, file));
      if (!json) continue;
      if (!isObject(json["info"]) || !Array.isArray(json["item"])) {
        this.#problems.push({ file: join(COLLECTIONS, file), reason: "No es una colección v2.1" });
        continue;
      }
      const changed = ensureIds(json, this.#deps.newId);
      const id = collectionId(json);
      if (this.#collections.has(id)) {
        this.#problems.push({ file: join(COLLECTIONS, file), reason: `Repite el id de otra colección (${id})` });
        continue;
      }
      this.#collections.set(id, { file: join(COLLECTIONS, file), json });
      if (changed) await this.#writeCollection(id);
    }

    for (const file of await this.#jsonFiles(ENVIRONMENTS)) {
      const json = await this.#readJson(join(ENVIRONMENTS, file));
      if (!json) continue;
      if (!Array.isArray(json["values"])) {
        this.#problems.push({ file: join(ENVIRONMENTS, file), reason: "No es un entorno de Postman" });
        continue;
      }
      if (typeof json["id"] !== "string" || !json["id"] || this.#environments.has(json["id"])) {
        json["id"] = this.#deps.newId();
        await writeAtomic(join(this.path, ENVIRONMENTS, file), serialize(json));
      }
      this.#environments.set(json["id"] as string, { file: join(ENVIRONMENTS, file), json });
    }
  }

  async #jsonFiles(dir: string): Promise<string[]> {
    const entries = await readdir(join(this.path, dir), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "es"));
  }

  async #readJson(relative: string): Promise<Json | null> {
    try {
      const raw = await readFile(join(this.path, relative));
      if (raw.byteLength > MAX_FILE_BYTES) throw new Error("supera 50 MB");
      const parsed: unknown = JSON.parse(raw.toString("utf8").replace(/^﻿/, ""));
      if (!isObject(parsed)) throw new Error("no es un objeto JSON");
      return parsed;
    } catch (err) {
      this.#problems.push({ file: relative, reason: `No se pudo leer: ${(err as Error).message}` });
      return null;
    }
  }

  /** One write at a time per file, in order. */
  #queue(file: string, data: () => string): Promise<void> {
    const previous = this.#writes.get(file) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => writeAtomic(join(this.path, file), data()));
    this.#writes.set(file, next);
    return next;
  }

  #writeCollection(id: string): Promise<void> {
    const c = this.#collection(id);
    return this.#queue(c.file, () => serialize(c.json));
  }

  #collection(id: string): Loaded {
    const c = this.#collections.get(id);
    if (!c) throw new WorkspaceError("NOT_FOUND", "La colección ya no existe");
    return c;
  }

  #environment(id: string): Loaded {
    const e = this.#environments.get(id);
    if (!e) throw new WorkspaceError("NOT_FOUND", "El entorno ya no existe");
    return e;
  }

  async #uniqueFile(dir: string, name: string, suffix: string): Promise<string> {
    const taken = new Set((await this.#jsonFiles(dir)).map((f) => f.toLowerCase()));
    const base = slug(name);
    for (let i = 1; ; i++) {
      const file = `${i === 1 ? base : `${base} ${i}`}${suffix}`;
      if (!taken.has(file.toLowerCase())) return join(dir, file);
    }
  }

  setActiveEnvironment(id: string | null): void {
    this.#activeEnvironmentId = id && this.#environments.has(id) ? id : null;
  }

  snapshot(): WorkspaceSnapshot {
    const collections: CollectionSummary[] = [...this.#collections.entries()].map(([id, c]) => ({
      id,
      name: collectionName(c.json),
      file: basename(c.file),
      tree: tree(c.json),
    }));
    const environments: EnvironmentSummary[] = [...this.#environments.entries()].map(([id, e]) => ({
      id,
      name: typeof e.json["name"] === "string" ? e.json["name"] : "Entorno",
      file: basename(e.file),
    }));
    return {
      path: this.path,
      name: this.#name,
      collections,
      environments,
      activeEnvironmentId: this.#activeEnvironmentId,
      sessionValues: this.hasSessionValues,
      problems: [...this.#problems],
    };
  }

  // ---------- requests ----------

  getItem(source: RequestSource): ItemView {
    const c = this.#collection(source.collectionId);
    const path = findPath(c.json, source.itemId);
    const item = path?.at(-1);
    if (!item || isFolder(item)) throw new WorkspaceError("NOT_FOUND", "La petición ya no existe");
    const { request, disabledParams } = itemToRequest(item);
    return {
      collectionId: source.collectionId,
      itemId: source.itemId,
      name: typeof item["name"] === "string" ? item["name"] : "Petición",
      path: path!.slice(0, -1).map((f) => String(f["name"] ?? "")),
      request,
      disabledParams,
      realtime: realtimeFromItem(item),
      grpc: grpcFromItem(item),
    };
  }

  async saveGrpcItem(source: RequestSource, g: GrpcRequest): Promise<void> {
    const c = this.#collection(source.collectionId);
    const item = findItem(c.json, source.itemId);
    if (!item || isFolder(item) || !grpcFromItem(item)) throw new WorkspaceError("NOT_FOUND", "La llamada ya no existe");
    applyGrpc(item, g);
    await this.#writeCollection(source.collectionId);
  }

  async createGrpcRequest(collectionId: string, parentId: string | null, name: string, g: GrpcRequest): Promise<string> {
    const c = this.#collection(collectionId);
    const id = this.#deps.newId();
    if (!insertItem(c.json, parentId, newGrpcItem(id, name, g))) throw new WorkspaceError("NOT_FOUND", "La carpeta ya no existe");
    await this.#writeCollection(collectionId);
    return id;
  }

  /** File paths saved gRPC calls point at, so main lets the engine read them. */
  grpcPaths(): string[] {
    return [...this.#collections.values()].flatMap((c) => grpcPaths(c.json));
  }

  async saveRealtimeItem(source: RequestSource, rt: RealtimeRequest): Promise<void> {
    const c = this.#collection(source.collectionId);
    const item = findItem(c.json, source.itemId);
    if (!item || isFolder(item) || !isRealtimeItem(item)) throw new WorkspaceError("NOT_FOUND", "La conexión ya no existe");
    applyRealtime(item, rt);
    await this.#writeCollection(source.collectionId);
  }

  async createRealtimeRequest(collectionId: string, parentId: string | null, name: string, rt: RealtimeRequest): Promise<string> {
    const c = this.#collection(collectionId);
    const id = this.#deps.newId();
    if (!insertItem(c.json, parentId, newRealtimeItem(id, name, rt))) throw new WorkspaceError("NOT_FOUND", "La carpeta ya no existe");
    await this.#writeCollection(collectionId);
    return id;
  }

  async saveItem(source: RequestSource, request: HttpRequest, disabledParams: KeyValue[]): Promise<void> {
    const c = this.#collection(source.collectionId);
    const item = findItem(c.json, source.itemId);
    if (!item || isFolder(item)) throw new WorkspaceError("NOT_FOUND", "La petición ya no existe");
    applyRequest(item, request, disabledParams);
    await this.#writeCollection(source.collectionId);
  }

  async createRequest(collectionId: string, parentId: string | null, name: string, request: HttpRequest, disabledParams: KeyValue[]): Promise<string> {
    const c = this.#collection(collectionId);
    const id = this.#deps.newId();
    if (!insertItem(c.json, parentId, newRequestItem(id, name, request, disabledParams))) {
      throw new WorkspaceError("NOT_FOUND", "La carpeta ya no existe");
    }
    await this.#writeCollection(collectionId);
    return id;
  }

  async createFolder(collectionId: string, parentId: string | null, name: string): Promise<string> {
    const c = this.#collection(collectionId);
    const id = this.#deps.newId();
    if (!insertItem(c.json, parentId, newFolder(id, name))) throw new WorkspaceError("NOT_FOUND", "La carpeta ya no existe");
    await this.#writeCollection(collectionId);
    return id;
  }

  async renameItem(collectionId: string, itemId: string, name: string): Promise<void> {
    if (!renameItem(this.#collection(collectionId).json, itemId, name)) throw new WorkspaceError("NOT_FOUND", "El elemento ya no existe");
    await this.#writeCollection(collectionId);
  }

  async removeItem(collectionId: string, itemId: string): Promise<void> {
    if (!removeItem(this.#collection(collectionId).json, itemId)) throw new WorkspaceError("NOT_FOUND", "El elemento ya no existe");
    await this.#writeCollection(collectionId);
  }

  async duplicateItem(collectionId: string, itemId: string): Promise<string> {
    const copy = duplicateItem(this.#collection(collectionId).json, itemId, this.#deps.newId);
    if (!copy) throw new WorkspaceError("NOT_FOUND", "El elemento ya no existe");
    await this.#writeCollection(collectionId);
    return String(copy["id"]);
  }

  // ---------- collections ----------

  async createCollection(name: string): Promise<string> {
    return this.addCollection(newCollection(this.#deps.newId(), name));
  }

  /** Adds a parsed v2.1 collection (new or imported) as a new file. */
  async addCollection(json: Json): Promise<string> {
    ensureIds(json, this.#deps.newId);
    let id = collectionId(json);
    if (this.#collections.has(id)) {
      // Importing the same collection twice keeps both, as separate collections.
      (json["info"] as Json)["_postman_id"] = id = this.#deps.newId();
    }
    const file = await this.#uniqueFile(COLLECTIONS, collectionName(json), ".postman_collection.json");
    this.#collections.set(id, { file, json });
    await this.#writeCollection(id);
    return id;
  }

  async renameCollection(id: string, name: string): Promise<void> {
    const c = this.#collection(id);
    (c.json["info"] as Json)["name"] = name;
    await this.#writeCollection(id);
  }

  async deleteCollection(id: string): Promise<void> {
    const c = this.#collection(id);
    await (this.#writes.get(c.file) ?? Promise.resolve()).catch(() => {});
    await rm(join(this.path, c.file), { force: true });
    this.#collections.delete(id);
  }

  // ---------- environments ----------

  #secretKey(envId: string, key: string): string {
    return `${this.#id}|${envId}|${key}`;
  }

  getEnvironment(id: string): EnvironmentView {
    const e = this.#environment(id);
    const values = (e.json["values"] as unknown[]).filter(isObject);
    return {
      id,
      name: typeof e.json["name"] === "string" ? e.json["name"] : "Entorno",
      rows: values.map((v) => {
        const key = String(v["key"] ?? "");
        const secret = v["type"] === "secret";
        const stored = secret ? this.#deps.secrets.get(this.#secretKey(id, key)) : undefined;
        return {
          key,
          value: secret ? "" : String(v["value"] ?? ""),
          enabled: v["enabled"] !== false,
          secret,
          hasValue: secret ? stored !== undefined && stored !== "" : String(v["value"] ?? "") !== "",
        };
      }),
    };
  }

  async saveEnvironment(id: string, name: string, rows: EnvironmentRowInput[]): Promise<void> {
    const e = this.#environment(id);
    const previousSecrets = new Set(
      (e.json["values"] as unknown[]).filter(isObject).filter((v) => v["type"] === "secret").map((v) => String(v["key"])),
    );
    const values: Json[] = [];
    const keep = new Set<string>();
    for (const row of rows.filter((r) => r.key.trim() !== "")) {
      if (row.secret) {
        keep.add(row.key);
        if (!row.keepSecret) await this.#deps.secrets.set(this.#secretKey(id, row.key), row.value);
        values.push({ key: row.key, value: "", type: "secret", enabled: row.enabled });
      } else {
        values.push({ key: row.key, value: row.value, type: "default", enabled: row.enabled });
      }
    }
    for (const key of previousSecrets) if (!keep.has(key)) await this.#deps.secrets.delete(this.#secretKey(id, key));
    e.json["name"] = name;
    e.json["values"] = values;
    await this.#queue(e.file, () => serialize(e.json));
  }

  async createEnvironment(name: string): Promise<string> {
    return this.addEnvironment({ id: this.#deps.newId(), name, values: [], _postman_variable_scope: "environment" });
  }

  /** Adds a Postman environment (new or imported). Secret values move to the encrypted store. */
  async addEnvironment(json: Json): Promise<string> {
    let id = typeof json["id"] === "string" && json["id"] ? json["id"] : this.#deps.newId();
    if (this.#environments.has(id)) id = this.#deps.newId();
    json["id"] = id;
    const values = Array.isArray(json["values"]) ? (json["values"] as unknown[]).filter(isObject) : [];
    for (const v of values) {
      if (v["type"] === "secret" && typeof v["value"] === "string" && v["value"] !== "") {
        await this.#deps.secrets.set(this.#secretKey(id, String(v["key"])), v["value"]);
        v["value"] = "";
      }
    }
    json["values"] = values;
    const file = await this.#uniqueFile(ENVIRONMENTS, typeof json["name"] === "string" ? json["name"] : "Entorno", ".postman_environment.json");
    this.#environments.set(id, { file, json });
    await this.#queue(file, () => serialize(json));
    return id;
  }

  async deleteEnvironment(id: string): Promise<void> {
    const e = this.#environment(id);
    for (const v of (e.json["values"] as unknown[]).filter(isObject)) {
      if (v["type"] === "secret") await this.#deps.secrets.delete(this.#secretKey(id, String(v["key"])));
    }
    await (this.#writes.get(e.file) ?? Promise.resolve()).catch(() => {});
    await rm(join(this.path, e.file), { force: true });
    this.#environments.delete(id);
    if (this.#activeEnvironmentId === id) this.#activeEnvironmentId = null;
  }

  // ---------- sending ----------

  static #overlay<T extends { key: string; value: string; enabled: boolean }>(base: T[], session: Map<string, string | null> | undefined, make: (key: string, value: string) => T): T[] {
    if (!session?.size) return base;
    const out = base.filter((v) => session.get(v.key) !== null).map((v) => (session.has(v.key) ? { ...v, value: session.get(v.key)!, enabled: true } : v));
    for (const [key, value] of session) if (value !== null && !base.some((v) => v.key === key)) out.push(make(key, value));
    return out;
  }

  #activeEnvironmentValues(): SendContext["environment"] {
    const id = this.#activeEnvironmentId;
    const base = id
      ? (this.#environment(id).json["values"] as unknown[]).filter(isObject).map((v) => {
          const key = String(v["key"] ?? "");
          const secret = v["type"] === "secret";
          const value = secret ? (this.#deps.secrets.get(this.#secretKey(id, key)) ?? "") : String(v["value"] ?? "");
          return { key, value, enabled: v["enabled"] !== false, secret };
        })
      : [];
    return Workspace.#overlay(base, this.#session.environment.get(id ?? ""), (key, value) => ({ key, value, enabled: true, secret: false }));
  }

  #collectionValues(collectionId: string, json: Json): SendContext["collectionVariables"] {
    return Workspace.#overlay(collectionVariables(json), this.#session.collection.get(collectionId), (key, value) => ({ key, value, enabled: true }));
  }

  /** Inherited auth and scripts, collection variables and the active environment (secrets included) for a send. */
  contextFor(source: RequestSource | null): SendContext {
    const environment = this.#activeEnvironmentValues();
    const empty = { authChain: [], eventChain: [], collectionVariables: [], environment };
    if (!source) return empty;
    const c = this.#collections.get(source.collectionId);
    if (!c || !findItem(c.json, source.itemId)) return empty;
    return {
      authChain: authChainFor(c.json, source.itemId),
      behaviorChain: behaviorChainFor(c.json, source.itemId),
      eventChain: eventChainFor(c.json, source.itemId),
      collectionVariables: this.#collectionValues(source.collectionId, c.json),
      environment,
    };
  }

  /** Applies what scripts set or unset, for the rest of the session. */
  applySession(changes: SessionChanges, collectionId: string | null): void {
    const put = (map: Map<string, Map<string, string | null>>, scope: string, list: SessionChanges["environment"]) => {
      if (!list.length) return;
      const values = map.get(scope) ?? new Map<string, string | null>();
      for (const c of list) values.set(c.key, c.value);
      map.set(scope, values);
    };
    put(this.#session.environment, this.#activeEnvironmentId ?? "", changes.environment);
    if (collectionId && this.#collections.has(collectionId)) put(this.#session.collection, collectionId, changes.collection);
  }

  /**
   * Writes what scripts set for the active environment and for this collection into
   * their files, then forgets it. Secret variables keep going to the encrypted store.
   * Returns how many variables changed.
   */
  async persistSession(collectionId: string | null): Promise<number> {
    let written = 0;
    const envId = this.#activeEnvironmentId;
    const envSession = envId ? this.#session.environment.get(envId) : undefined;
    if (envId && envSession?.size) {
      const e = this.#environment(envId);
      const values = (Array.isArray(e.json["values"]) ? (e.json["values"] as unknown[]) : []).filter(isObject);
      for (const [key, value] of envSession) {
        const i = values.findIndex((v) => v["key"] === key);
        const secret = i >= 0 && values[i]!["type"] === "secret";
        if (value === null) {
          if (i < 0) continue;
          if (secret) await this.#deps.secrets.delete(this.#secretKey(envId, key));
          values.splice(i, 1);
        } else if (secret) {
          await this.#deps.secrets.set(this.#secretKey(envId, key), value);
        } else if (i >= 0) {
          values[i] = { ...values[i], value, enabled: true };
        } else {
          values.push({ key, value, type: "default", enabled: true });
        }
        written++;
      }
      e.json["values"] = values;
      await this.#queue(e.file, () => serialize(e.json));
      this.#session.environment.delete(envId);
    }
    const colSession = collectionId ? this.#session.collection.get(collectionId) : undefined;
    if (collectionId && colSession?.size && this.#collections.has(collectionId)) {
      const c = this.#collection(collectionId);
      const vars = (Array.isArray(c.json["variable"]) ? (c.json["variable"] as unknown[]) : []).filter(isObject);
      for (const [key, value] of colSession) {
        const i = vars.findIndex((v) => v["key"] === key);
        if (value === null) {
          if (i < 0) continue;
          vars.splice(i, 1);
        } else if (i >= 0) {
          vars[i] = { ...vars[i], value };
        } else {
          vars.push({ key, value });
        }
        written++;
      }
      c.json["variable"] = vars;
      await this.#writeCollection(collectionId);
      this.#session.collection.delete(collectionId);
    }
    return written;
  }

  /** Forgets every value set by scripts. */
  clearSession(): void {
    this.#session.environment.clear();
    this.#session.collection.clear();
  }

  get hasSessionValues(): boolean {
    return [...this.#session.environment.values(), ...this.#session.collection.values()].some((m) => m.size > 0);
  }

  /** Variables a request can use, for previews and autocompletion. Secret values are never included. */
  variablesFor(collectionId: string | null): VariableView[] {
    const out: VariableView[] = [];
    const envSession = this.#session.environment.get(this.#activeEnvironmentId ?? "");
    for (const v of this.#activeEnvironmentValues().filter((v) => v.enabled && v.key)) {
      const secret = v.secret === true;
      out.push({ key: v.key, value: secret ? null : v.value, secret, source: envSession?.has(v.key) ? "sesión" : "entorno" });
    }
    const c = collectionId ? this.#collections.get(collectionId) : undefined;
    if (c && collectionId) {
      const colSession = this.#session.collection.get(collectionId);
      for (const v of this.#collectionValues(collectionId, c.json).filter((v) => v.enabled)) {
        if (!out.some((o) => o.key === v.key)) out.push({ key: v.key, value: v.value, secret: false, source: colSession?.has(v.key) ? "sesión" : "colección" });
      }
    }
    return out;
  }
}

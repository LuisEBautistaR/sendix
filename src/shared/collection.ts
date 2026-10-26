/**
 * Postman Collection v2.1 files as Sendix edits them.
 *
 * The file on disk is the source of truth and is kept as plain JSON. Edits touch
 * only the keys Sendix understands (method, url, header, body, auth and two
 * protocol settings); everything else — scripts, saved examples, descriptions,
 * auth or body types Sendix cannot edit yet — stays exactly as it was.
 */
import { BEHAVIOR_KEYS, DEFAULT_SETTINGS, EMPTY_SCRIPTS, RAW_LANGUAGES, behaviorOf, type RequestSettings, type HttpRequest, type KeyValue, type RawLanguage, type RequestAuth, type RequestBody, type RequestScripts } from "./http";
import { DEFAULT_REALTIME_SETTINGS, type RealtimeRequest } from "./realtime";
import { DEFAULT_GRPC_SETTINGS, type GrpcRequest } from "./grpc";

export type Json = Record<string, unknown>;

export const COLLECTION_SCHEMA_V21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

export interface TreeNode {
  id: string;
  name: string;
  kind: "folder" | "request";
  method?: string;
  children?: TreeNode[];
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : isObject(v) && typeof v["content"] === "string" ? v["content"] : undefined);

export const isFolder = (item: Json): boolean => Array.isArray(item["item"]);
const children = (node: Json): Json[] => (Array.isArray(node["item"]) ? (node["item"] as unknown[]).filter(isObject) : []);

/** Gives every item an id (v2.1 allows `id` on items) and the collection a `_postman_id`. Returns true if anything changed. */
export function ensureIds(collection: Json, newId: () => string): boolean {
  let changed = false;
  if (!isObject(collection["info"])) {
    collection["info"] = { name: "Colección", schema: COLLECTION_SCHEMA_V21 };
    changed = true;
  }
  const info = collection["info"] as Json;
  if (typeof info["_postman_id"] !== "string" || !info["_postman_id"]) {
    info["_postman_id"] = newId();
    changed = true;
  }
  const seen = new Set<string>();
  const walk = (node: Json) => {
    for (const item of children(node)) {
      // Duplicate ids (possible in hand-edited files) would make edits ambiguous.
      if (typeof item["id"] !== "string" || !item["id"] || seen.has(item["id"])) {
        item["id"] = newId();
        changed = true;
      }
      seen.add(item["id"] as string);
      walk(item);
    }
  };
  if (!Array.isArray(collection["item"])) {
    collection["item"] = [];
    changed = true;
  }
  walk(collection);
  return changed;
}

export function collectionId(collection: Json): string {
  return str((collection["info"] as Json | undefined)?.["_postman_id"]);
}

export function collectionName(collection: Json): string {
  return str((collection["info"] as Json | undefined)?.["name"], "Colección sin nombre");
}

function requestMethod(item: Json): string {
  const x = item["x-sendix"];
  if (isObject(x) && x["type"] === "websocket") return "WS";
  if (isObject(x) && x["type"] === "socketio") return "SIO";
  if (isObject(x) && x["type"] === "grpc") return "GRPC";
  const request = item["request"];
  if (isObject(request)) return str(request["method"], "GET").toUpperCase();
  return "GET";
}

export function tree(node: Json): TreeNode[] {
  return children(node).map((item) =>
    isFolder(item)
      ? { id: str(item["id"]), name: str(item["name"], "Carpeta"), kind: "folder" as const, children: tree(item) }
      : { id: str(item["id"]), name: str(item["name"], "Petición"), kind: "request" as const, method: requestMethod(item) },
  );
}

/** The chain of items from the top level down to `id` (inclusive), or null. */
export function findPath(collection: Json, id: string): Json[] | null {
  const walk = (node: Json, trail: Json[]): Json[] | null => {
    for (const item of children(node)) {
      const next = [...trail, item];
      if (item["id"] === id) return next;
      const found = walk(item, next);
      if (found) return found;
    }
    return null;
  };
  return walk(collection, []);
}

export function findItem(collection: Json, id: string): Json | null {
  return findPath(collection, id)?.at(-1) ?? null;
}

function parentOf(collection: Json, id: string): Json | null {
  const path = findPath(collection, id);
  if (!path) return null;
  return path.length > 1 ? path[path.length - 2]! : collection;
}

/** Auth that applies above a request: the collection's, then each enclosing folder's (null where a level sets none). */
export function authChainFor(collection: Json, id: string): Array<Json | null> {
  const path = findPath(collection, id) ?? [];
  const authOf = (node: Json) => (isObject(node["auth"]) ? (node["auth"] as Json) : null);
  return [authOf(collection), ...path.slice(0, -1).map(authOf)];
}

/** Request settings stored in an item's protocolProfileBehavior; values of the wrong type are ignored. */
export function settingsFromBehavior(ppb: Json): RequestSettings {
  const settings: RequestSettings = {
    ...DEFAULT_SETTINGS,
    followRedirects: ppb["followRedirects"] === false ? false : DEFAULT_SETTINGS.followRedirects,
    verifyTls: ppb["strictSSL"] === false ? false : DEFAULT_SETTINGS.verifyTls,
  };
  const max = ppb["maxRedirects"];
  if (typeof max === "number" && Number.isInteger(max) && max >= 0 && max <= 100) settings.maxRedirects = max;
  for (const key of ["followOriginalHttpMethod", "followAuthorizationHeader", "removeRefererHeaderOnRedirect", "disableUrlEncoding", "disableCookies"] as const) {
    if (typeof ppb[key] === "boolean") settings[key] = ppb[key] as boolean;
  }
  return settings;
}

/** protocolProfileBehavior of the collection, then of each enclosing folder (null where a level has none). */
export function behaviorChainFor(collection: Json, id: string): Array<Json | null> {
  const path = findPath(collection, id) ?? [];
  const ppbOf = (node: Json) => (isObject(node["protocolProfileBehavior"]) && Object.keys(node["protocolProfileBehavior"] as Json).length ? (node["protocolProfileBehavior"] as Json) : null);
  return [ppbOf(collection), ...path.slice(0, -1).map(ppbOf)];
}

/** Scripts that run around a request: the collection's events, then each enclosing folder's (null where a level has none). */
export function eventChainFor(collection: Json, id: string): Array<Json[] | null> {
  const path = findPath(collection, id) ?? [];
  const eventsOf = (node: Json) => (Array.isArray(node["event"]) && node["event"].length ? (node["event"] as unknown[]).filter(isObject) : null);
  return [eventsOf(collection), ...path.slice(0, -1).map(eventsOf)];
}

export function collectionVariables(collection: Json): Array<{ key: string; value: string; enabled: boolean }> {
  const vars = Array.isArray(collection["variable"]) ? (collection["variable"] as unknown[]).filter(isObject) : [];
  return vars
    .filter((v) => typeof v["key"] === "string")
    .map((v) => ({ key: v["key"] as string, value: str(v["value"]), enabled: v["disabled"] !== true }));
}

// ---------- URLs ----------

function urlObjectToString(url: Json): string {
  if (typeof url["raw"] === "string") return url["raw"];
  const protocol = typeof url["protocol"] === "string" ? `${url["protocol"]}://` : "";
  const host = Array.isArray(url["host"]) ? (url["host"] as unknown[]).map((h) => str(h)).join(".") : str(url["host"]);
  const port = url["port"] !== undefined && url["port"] !== "" ? `:${str(url["port"])}` : "";
  const path = Array.isArray(url["path"])
    ? `/${(url["path"] as unknown[]).map((p) => (isObject(p) ? str(p["value"]) : str(p))).join("/")}`
    : typeof url["path"] === "string" && url["path"]
      ? `/${(url["path"] as string).replace(/^\//, "")}`
      : "";
  const query = Array.isArray(url["query"])
    ? (url["query"] as unknown[])
        .filter(isObject)
        .filter((q) => q["disabled"] !== true)
        .map((q) => (q["value"] === null || q["value"] === undefined ? str(q["key"]) : `${str(q["key"])}=${str(q["value"])}`))
        .join("&")
    : "";
  const hash = typeof url["hash"] === "string" && url["hash"] ? `#${url["hash"]}` : "";
  return `${protocol}${host}${port}${path}${query ? `?${query}` : ""}${hash}`;
}

export function urlToString(url: unknown): string {
  if (typeof url === "string") return url;
  if (isObject(url)) return urlObjectToString(url);
  return "";
}

/** v2.1 url object for a raw URL, keeping unchecked query parameters and path variables. */
export function buildUrlObject(raw: string, disabledParams: readonly KeyValue[], previous: unknown): Json {
  const hashAt = raw.indexOf("#");
  const hash = hashAt >= 0 ? raw.slice(hashAt + 1) : undefined;
  let rest = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = rest.indexOf("?");
  const queryString = queryAt >= 0 ? rest.slice(queryAt + 1) : "";
  rest = queryAt >= 0 ? rest.slice(0, queryAt) : rest;

  const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  const protocol = proto?.[1];
  if (proto) rest = rest.slice(proto[0].length);
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const pathPart = slash >= 0 ? rest.slice(slash + 1) : "";
  const portMatch = /^(.*?):(\d+|\{\{[^}]+\}\})$/.exec(authority);
  const hostPart = portMatch ? portMatch[1]! : authority;
  const port = portMatch?.[2];

  const query = [
    ...queryString
      .split("&")
      .filter((p) => p !== "")
      .map((p) => {
        const eq = p.indexOf("=");
        return eq < 0 ? { key: p, value: null } : { key: p.slice(0, eq), value: p.slice(eq + 1) };
      }),
    ...disabledParams.map((p) => ({ key: p.key, value: p.value, disabled: true, ...(p.description ? { description: p.description } : {}) })),
  ];

  const url: Json = { raw };
  if (protocol) url["protocol"] = protocol;
  url["host"] = hostPart.startsWith("{{") ? [hostPart] : hostPart.split(".");
  if (port) url["port"] = port;
  if (pathPart !== "" || rest.endsWith("/")) url["path"] = pathPart.split("/");
  if (query.length) url["query"] = query;
  if (hash !== undefined) url["hash"] = hash;
  if (isObject(previous) && Array.isArray(previous["variable"])) url["variable"] = previous["variable"];
  return url;
}

// ---------- request <-> item ----------

function headerRows(header: unknown): KeyValue[] {
  if (typeof header === "string") {
    return header
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colon = line.indexOf(":");
        return { key: colon < 0 ? line : line.slice(0, colon).trim(), value: colon < 0 ? "" : line.slice(colon + 1).trim(), enabled: true };
      });
  }
  if (!Array.isArray(header)) return [];
  return header.filter(isObject).map((h) => {
    const description = text(h["description"]);
    return { key: str(h["key"]), value: str(h["value"]), enabled: h["disabled"] !== true, ...(description ? { description } : {}) };
  });
}

const rowsToJson = (rows: readonly KeyValue[], extra: Json = {}) =>
  rows
    .filter((r) => r.key !== "" || r.value !== "")
    .map((r) => ({ key: r.key, value: r.value, ...extra, ...(r.enabled ? {} : { disabled: true }), ...(r.description ? { description: r.description } : {}) }));

function bodyFromItem(body: unknown): RequestBody {
  if (!isObject(body) || typeof body["mode"] !== "string") return { mode: "none" };
  const mode = body["mode"];
  if (body["disabled"] === true) return { mode: "preserved", label: `${mode} (desactivado)`, data: body };
  if (mode === "raw") {
    const options = isObject(body["options"]) && isObject(body["options"]["raw"]) ? (body["options"]["raw"] as Json) : {};
    const lang = str(options["language"], "text");
    const language: RawLanguage = (RAW_LANGUAGES as readonly string[]).includes(lang) ? (lang as RawLanguage) : "text";
    return { mode: "raw", language, raw: str(body["raw"]) };
  }
  if (mode === "urlencoded") return { mode: "urlencoded", fields: headerRows(body["urlencoded"]) };
  if (mode === "formdata") {
    const entries = Array.isArray(body["formdata"]) ? (body["formdata"] as unknown[]).filter(isObject) : [];
    if (entries.some((e) => e["type"] === "file")) return { mode: "preserved", label: "form-data con archivos", data: body };
    return { mode: "formdata", fields: headerRows(entries) };
  }
  const labels: Record<string, string> = { file: "archivo binario", graphql: "GraphQL" };
  return { mode: "preserved", label: labels[mode] ?? mode, data: body };
}

function authParams(list: unknown): Record<string, string> {
  if (!Array.isArray(list)) return isObject(list) ? Object.fromEntries(Object.entries(list).map(([k, v]) => [k, str(v)])) : {};
  return Object.fromEntries(list.filter(isObject).map((p) => [str(p["key"]), str(p["value"])]));
}

export function authFromItem(auth: unknown): RequestAuth {
  if (!isObject(auth)) return { type: "inherit" };
  const type = str(auth["type"]);
  if (type === "noauth") return { type: "none" };
  if (type === "bearer") return { type: "bearer", token: authParams(auth["bearer"])["token"] ?? "" };
  if (type === "basic") {
    const p = authParams(auth["basic"]);
    return { type: "basic", username: p["username"] ?? "", password: p["password"] ?? "" };
  }
  if (type === "apikey") {
    const p = authParams(auth["apikey"]);
    return { type: "apikey", key: p["key"] ?? "", value: p["value"] ?? "", in: p["in"] === "query" ? "query" : "header" };
  }
  const labels: Record<string, string> = { oauth2: "OAuth 2.0", oauth1: "OAuth 1.0", digest: "Digest", awsv4: "AWS Signature", ntlm: "NTLM", hawk: "Hawk", akamai: "Akamai EdgeGrid", jwt: "JWT", asap: "ASAP" };
  return { type: "preserved", label: labels[type] ?? type, data: auth };
}

const scriptText = (script: unknown): string => {
  if (!isObject(script)) return "";
  const exec = script["exec"];
  return Array.isArray(exec) ? exec.map((l) => str(l)).join("\n") : str(exec);
};

/** The item's pre-request and test scripts (several events of one kind are joined). */
export function scriptsFromEvents(events: unknown): RequestScripts {
  const list = Array.isArray(events) ? events.filter(isObject) : [];
  const of = (listen: string) =>
    list
      .filter((e) => e["listen"] === listen)
      .map((e) => scriptText(e["script"]))
      .filter((t) => t !== "")
      .join("\n");
  return { prerequest: of("prerequest"), test: of("test") };
}

/** Writes scripts back into an `event` array, keeping each event's other fields (id, type, packages…). */
export function scriptsToEvents(events: unknown, scripts: RequestScripts): Json[] {
  let list = Array.isArray(events) ? events.filter(isObject).map((e) => ({ ...e })) : [];
  for (const listen of ["prerequest", "test"] as const) {
    const text = scripts[listen];
    const existing = list.filter((e) => e["listen"] === listen);
    if (text.trim() === "") {
      list = list.filter((e) => e["listen"] !== listen);
    } else if (existing.length) {
      const first = existing[0]!;
      first["script"] = { type: "text/javascript", ...(isObject(first["script"]) ? first["script"] : {}), exec: text.split("\n") };
      list = list.filter((e) => e["listen"] !== listen || e === first);
    } else {
      list.push({ listen, script: { type: "text/javascript", exec: text.split("\n") } });
    }
  }
  return list;
}

export interface ItemRequest {
  request: HttpRequest;
  /** Unchecked query parameters, which are not part of the URL. */
  disabledParams: KeyValue[];
}

export function itemToRequest(item: Json): ItemRequest {
  const r = item["request"];
  const request = isObject(r) ? r : { url: str(r) };
  const url = request["url"];
  const disabledParams =
    isObject(url) && Array.isArray(url["query"])
      ? (url["query"] as unknown[])
          .filter(isObject)
          .filter((q) => q["disabled"] === true)
          .map((q) => {
            const description = text(q["description"]);
            return { key: str(q["key"]), value: str(q["value"]), enabled: false, ...(description ? { description } : {}) };
          })
      : [];
  const ppb = isObject(item["protocolProfileBehavior"]) ? (item["protocolProfileBehavior"] as Json) : {};
  return {
    request: {
      method: str(request["method"], "GET").toUpperCase(),
      url: urlToString(url),
      headers: headerRows(request["header"]),
      body: bodyFromItem(request["body"]),
      auth: authFromItem(request["auth"]),
      settings: settingsFromBehavior(ppb),
      scripts: scriptsFromEvents(item["event"]),
    },
    disabledParams,
  };
}

function authToJson(auth: RequestAuth): Json | null | undefined {
  switch (auth.type) {
    case "inherit":
      return null;
    case "none":
      return { type: "noauth" };
    case "bearer":
      return { type: "bearer", bearer: [{ key: "token", value: auth.token, type: "string" }] };
    case "basic":
      return { type: "basic", basic: [{ key: "username", value: auth.username, type: "string" }, { key: "password", value: auth.password, type: "string" }] };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.key, type: "string" },
          { key: "value", value: auth.value, type: "string" },
          { key: "in", value: auth.in, type: "string" },
        ],
      };
    case "preserved":
      // Unchanged ones never get here; a new one (Digest from a cURL paste) is written as it came.
      return isObject(auth.data) ? (auth.data as Json) : undefined;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Writes the editable parts of `request` into the item, leaving every other key as it was.
 * A part that did not change keeps its original JSON, so saving an untouched request is a no-op.
 */
export function applyRequest(item: Json, request: HttpRequest, disabledParams: readonly KeyValue[]): void {
  const previous = isObject(item["request"]) ? (item["request"] as Json) : {};
  const before = itemToRequest(item);
  const next: Json = { ...previous };
  next["method"] = request.method.toUpperCase();

  if (!(before.request.url === request.url && same(before.disabledParams, disabledParams) && previous["url"] !== undefined)) {
    next["url"] =
      !isObject(previous["url"]) && disabledParams.length === 0 ? request.url : buildUrlObject(request.url, disabledParams, previous["url"]);
  }
  if (!same(before.request.headers, request.headers)) next["header"] = rowsToJson(request.headers);

  if (!same(before.request.body, request.body)) {
    switch (request.body.mode) {
      case "none":
        delete next["body"];
        break;
      case "raw":
        next["body"] = { mode: "raw", raw: request.body.raw, options: { raw: { language: request.body.language } } };
        break;
      case "urlencoded":
        next["body"] = { mode: "urlencoded", urlencoded: rowsToJson(request.body.fields) };
        break;
      case "formdata":
        next["body"] = { mode: "formdata", formdata: rowsToJson(request.body.fields, { type: "text" }) };
        break;
      case "preserved":
        break;
    }
  }

  if (!same(before.request.auth, request.auth)) {
    const auth = authToJson(request.auth);
    if (auth === null) delete next["auth"];
    else if (auth !== undefined) next["auth"] = auth;
  }
  item["request"] = next;

  const scripts = request.scripts ?? EMPTY_SCRIPTS;
  if (!same(before.request.scripts ?? EMPTY_SCRIPTS, scripts)) {
    const events = scriptsToEvents(item["event"], scripts);
    if (events.length) item["event"] = events;
    else delete item["event"];
  }

  const ppb: Json = isObject(item["protocolProfileBehavior"]) ? { ...(item["protocolProfileBehavior"] as Json) } : {};
  if (request.settings.followRedirects) delete ppb["followRedirects"];
  else ppb["followRedirects"] = false;
  if (request.settings.verifyTls) delete ppb["strictSSL"];
  else ppb["strictSSL"] = false;
  for (const key of BEHAVIOR_KEYS) delete ppb[key];
  Object.assign(ppb, behaviorOf(request.settings));
  if (Object.keys(ppb).length) item["protocolProfileBehavior"] = ppb;
  else delete item["protocolProfileBehavior"];
}

// ---------- structure edits ----------

export function newCollection(id: string, name: string): Json {
  return { info: { _postman_id: id, name, schema: COLLECTION_SCHEMA_V21 }, item: [] };
}

export function newRequestItem(id: string, name: string, request: HttpRequest, disabledParams: readonly KeyValue[] = []): Json {
  const item: Json = { id, name, request: {}, response: [] };
  applyRequest(item, request, disabledParams);
  return item;
}

export function newFolder(id: string, name: string): Json {
  return { id, name, item: [] };
}

/** Inserts into a folder (or the collection root when parentId is null). Returns false if the parent is not a folder. */
export function insertItem(collection: Json, parentId: string | null, item: Json): boolean {
  const parent = parentId === null ? collection : findItem(collection, parentId);
  if (!parent || (parentId !== null && !isFolder(parent))) return false;
  if (!Array.isArray(parent["item"])) parent["item"] = [];
  (parent["item"] as unknown[]).push(item);
  return true;
}

export function removeItem(collection: Json, id: string): boolean {
  const parent = parentOf(collection, id);
  if (!parent) return false;
  parent["item"] = children(parent).filter((i) => i["id"] !== id);
  return true;
}

export function renameItem(collection: Json, id: string, name: string): boolean {
  const item = findItem(collection, id);
  if (!item) return false;
  item["name"] = name;
  return true;
}

/** Copies an item (folders with everything inside) right after the original, with fresh ids. */
export function duplicateItem(collection: Json, id: string, newId: () => string): Json | null {
  const parent = parentOf(collection, id);
  const original = findItem(collection, id);
  if (!parent || !original) return null;
  const copy = JSON.parse(JSON.stringify(original)) as Json;
  const reId = (node: Json) => {
    node["id"] = newId();
    children(node).forEach(reId);
  };
  reId(copy);
  copy["name"] = `${str(original["name"])} (copia)`;
  const list = children(parent);
  list.splice(list.indexOf(original) + 1, 0, copy);
  parent["item"] = list;
  return copy;
}

// ---------- WebSocket and Socket.IO items ----------

/**
 * Connections are stored as v2.1 items too: `request` holds the URL and headers
 * (a GET, so other tools still open the file) and `x-sendix` the rest. Tools that
 * do not know `x-sendix` ignore it.
 */
const X_SENDIX = "x-sendix";

function xSendix(item: Json): Json | null {
  const x = item[X_SENDIX];
  return isObject(x) && (x["type"] === "websocket" || x["type"] === "socketio") ? x : null;
}

export const isRealtimeItem = (item: Json): boolean => xSendix(item) !== null;

export function realtimeFromItem(item: Json): RealtimeRequest | null {
  const x = xSendix(item);
  if (!x) return null;
  const r = isObject(item["request"]) ? (item["request"] as Json) : {};
  const s = isObject(x["settings"]) ? (x["settings"] as Json) : {};
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
  const messages = Array.isArray(x["messages"]) ? (x["messages"] as unknown[]).filter(isObject) : [];
  return {
    protocol: x["type"] as RealtimeRequest["protocol"],
    url: urlToString(r["url"]),
    headers: headerRows(r["header"]),
    subprotocols: Array.isArray(x["subprotocols"]) ? (x["subprotocols"] as unknown[]).filter((p): p is string => typeof p === "string" && p !== "") : [],
    settings: {
      reconnect: s["reconnect"] === true,
      maxRetries: num(s["maxRetries"], DEFAULT_REALTIME_SETTINGS.maxRetries, 1, 20),
      timeoutMs: num(s["timeoutMs"], DEFAULT_REALTIME_SETTINGS.timeoutMs, 1_000, 120_000),
      verifyTls: s["verifyTls"] !== false,
      path: typeof s["path"] === "string" ? s["path"] : DEFAULT_REALTIME_SETTINGS.path,
      auth: typeof s["auth"] === "string" ? s["auth"] : "",
    },
    messages: messages.map((m) => ({
      name: str(m["name"], "Mensaje"),
      body: str(m["body"]),
      language: m["language"] === "text" ? "text" : "json",
      event: str(m["event"]),
    })),
  };
}

/** Writes a connection into its item, keeping keys Sendix does not use. */
export function applyRealtime(item: Json, rt: RealtimeRequest): void {
  const before = realtimeFromItem(item);
  const previous = isObject(item["request"]) ? (item["request"] as Json) : {};
  const next: Json = { ...previous, method: "GET" };
  if (before?.url !== rt.url || previous["url"] === undefined) next["url"] = rt.url;
  if (!before || !same(before.headers, rt.headers)) next["header"] = rowsToJson(rt.headers);
  item["request"] = next;
  const x: Json = { ...(xSendix(item) ?? {}), type: rt.protocol, settings: { ...rt.settings }, messages: rt.messages.map((m) => ({ ...m })) };
  if (rt.subprotocols.length) x["subprotocols"] = [...rt.subprotocols];
  else delete x["subprotocols"];
  item[X_SENDIX] = x;
}

export function newRealtimeItem(id: string, name: string, rt: RealtimeRequest): Json {
  const item: Json = { id, name, request: {} };
  applyRealtime(item, rt);
  return item;
}

// ---------- gRPC items ----------

export function grpcFromItem(item: Json): GrpcRequest | null {
  const x = item["x-sendix"];
  if (!isObject(x) || x["type"] !== "grpc") return null;
  const r = isObject(item["request"]) ? (item["request"] as Json) : {};
  const d = isObject(x["definition"]) ? (x["definition"] as Json) : {};
  const s = isObject(x["settings"]) ? (x["settings"] as Json) : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p !== "") : []);
  const tls = s["tls"] === "tls" || s["tls"] === "insecure" ? s["tls"] : "none";
  return {
    target: urlToString(r["url"]),
    definition: { source: d["source"] === "files" ? "files" : "reflection", files: strings(d["files"]), importPaths: strings(d["importPaths"]) },
    service: str(x["service"]),
    method: str(x["method"]),
    message: str(x["message"], "{}"),
    metadata: headerRows(r["header"]),
    settings: {
      tls,
      caFile: str(s["caFile"]),
      certFile: str(s["certFile"]),
      keyFile: str(s["keyFile"]),
      deadlineMs: typeof s["deadlineMs"] === "number" && s["deadlineMs"] >= 0 ? Math.min(3_600_000, Math.round(s["deadlineMs"])) : DEFAULT_GRPC_SETTINGS.deadlineMs,
    },
  };
}

export function applyGrpc(item: Json, g: GrpcRequest): void {
  const before = grpcFromItem(item);
  const previous = isObject(item["request"]) ? (item["request"] as Json) : {};
  const next: Json = { ...previous, method: "POST" };
  if (before?.target !== g.target || previous["url"] === undefined) next["url"] = g.target;
  if (!before || !same(before.metadata, g.metadata)) next["header"] = rowsToJson(g.metadata);
  item["request"] = next;
  const x = isObject(item["x-sendix"]) ? (item["x-sendix"] as Json) : {};
  item["x-sendix"] = { ...x, type: "grpc", definition: { ...g.definition }, service: g.service, method: g.method, message: g.message, settings: { ...g.settings } };
}

export function newGrpcItem(id: string, name: string, g: GrpcRequest): Json {
  const item: Json = { id, name, request: {} };
  applyGrpc(item, g);
  return item;
}

/** Every file path that gRPC items of a collection point at (.proto files, import folders, certificates). */
export function grpcPaths(collection: Json): string[] {
  const out: string[] = [];
  const walk = (node: Json) => {
    for (const item of children(node)) {
      const g = grpcFromItem(item);
      if (g) out.push(...g.definition.files, ...g.definition.importPaths, g.settings.caFile, g.settings.certFile, g.settings.keyFile);
      walk(item);
    }
  };
  walk(collection);
  return out.filter(Boolean);
}

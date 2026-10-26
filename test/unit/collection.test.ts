import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyRequest,
  authChainFor,
  buildUrlObject,
  collectionVariables,
  duplicateItem,
  ensureIds,
  eventChainFor,
  findItem,
  insertItem,
  grpcFromItem,
  grpcPaths,
  newGrpcItem,
  isRealtimeItem,
  itemToRequest,
  newFolder,
  newRealtimeItem,
  newRequestItem,
  realtimeFromItem,
  applyRealtime,
  removeItem,
  renameItem,
  scriptsFromEvents,
  scriptsToEvents,
  tree,
  type Json,
} from "@shared/collection";
import { DEFAULT_SETTINGS } from "@shared/http";
import { emptyRealtime } from "@shared/realtime";
import { emptyGrpc } from "@shared/grpc";

const fixture = () => JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/tienda.postman_collection.json"), "utf8")) as Json;
let n = 0;
const newId = () => `id-${++n}`;

const loaded = () => {
  const c = fixture();
  ensureIds(c, newId);
  return c;
};
const idOf = (c: Json, name: string): string => {
  const find = (nodes: ReturnType<typeof tree>): string | undefined => {
    for (const node of nodes) {
      if (node.name === name) return node.id;
      const inner = node.children && find(node.children);
      if (inner) return inner;
    }
  };
  return find(tree(c))!;
};

describe("collection model", () => {
  it("adds missing ids without touching anything else", () => {
    const original = fixture();
    const c = fixture();
    expect(ensureIds(c, newId)).toBe(true);
    expect(ensureIds(c, newId)).toBe(false);
    const strip = (node: unknown): unknown =>
      Array.isArray(node) ? node.map(strip) : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).filter(([k]) => k !== "id").map(([k, v]) => [k, strip(v)])) : node;
    expect(strip(c)).toEqual(strip(original));
  });

  it("lists folders and requests with their methods", () => {
    expect(tree(loaded()).map((n) => [n.name, n.kind, n.method ?? null, n.children?.length ?? null])).toEqual([
      ["Productos", "folder", null, 2],
      ["Crear pedido", "request", "POST", null],
      ["Salud", "request", "GET", null],
    ]);
  });

  it("reads url objects, unchecked params, header strings and every auth kind", () => {
    const c = loaded();
    const list = itemToRequest(findItem(c, idOf(c, "Listar productos"))!);
    expect(list.request.url).toBe("{{base}}/productos?categoria={{categoria}}");
    expect(list.disabledParams).toEqual([{ key: "pagina", value: "2", enabled: false, description: "desactivado" }]);
    expect(list.request.headers[1]).toEqual({ key: "X-Debug", value: "1", enabled: false, description: "solo pruebas" });
    expect(list.request.auth).toEqual({ type: "inherit" });

    const order = itemToRequest(findItem(c, idOf(c, "Crear pedido"))!).request;
    expect(order.headers).toEqual([
      { key: "Content-Type", value: "application/json", enabled: true },
      { key: "X-Origen", value: "tests", enabled: true },
    ]);
    expect(order.body).toEqual({ mode: "raw", language: "json", raw: '{"producto":"prd_1"}' });
    expect(order.auth).toMatchObject({ type: "preserved", label: "OAuth 2.0" });
    expect(order.settings).toEqual({ ...DEFAULT_SETTINGS, followRedirects: false });

    expect(itemToRequest(findItem(c, idOf(c, "Subir foto"))!).request.body).toMatchObject({ mode: "preserved", label: "form-data con archivos" });
    expect(itemToRequest(findItem(c, idOf(c, "Salud"))!).request.auth).toEqual({ type: "none" });
  });

  it("saving an untouched request leaves the file identical", () => {
    const c = loaded();
    const before = JSON.stringify(c);
    for (const name of ["Listar productos", "Subir foto", "Crear pedido", "Salud"]) {
      const item = findItem(c, idOf(c, name))!;
      const { request, disabledParams } = itemToRequest(item);
      applyRequest(item, request, disabledParams);
    }
    expect(JSON.stringify(c)).toBe(before);
  });

  it("writes only what changed and keeps scripts, examples and other settings", () => {
    const c = loaded();
    const item = findItem(c, idOf(c, "Listar productos"))!;
    const { request, disabledParams } = itemToRequest(item);
    applyRequest(item, { ...request, url: "{{base}}/productos?categoria=te&limite=5", auth: { type: "none" } }, disabledParams);
    const r = item["request"] as Json;
    expect(r["url"]).toMatchObject({
      raw: "{{base}}/productos?categoria=te&limite=5",
      host: ["{{base}}"],
      path: ["productos"],
      query: [{ key: "categoria", value: "te" }, { key: "limite", value: "5" }, { key: "pagina", value: "2", disabled: true }],
    });
    expect(r["auth"]).toEqual({ type: "noauth" });
    expect(r["description"]).toBe("Lista paginada");
    expect((r["header"] as Json[])[0]).toEqual({ key: "Accept", value: "application/json", type: "text" });
    expect(item["event"]).toBeDefined();
    expect(item["response"]).toHaveLength(1);

    const order = findItem(c, idOf(c, "Crear pedido"))!;
    const o = itemToRequest(order);
    applyRequest(order, { ...o.request, settings: DEFAULT_SETTINGS }, o.disabledParams);
    expect(order["protocolProfileBehavior"]).toEqual({ disableBodyPruning: true });
    expect((order["request"] as Json)["auth"]).toMatchObject({ type: "oauth2" });
  });

  it("parses raw URLs into v2.1 url objects", () => {
    expect(buildUrlObject("https://api.example.test:8443/v1/items/?a=1&b#top", [], undefined)).toEqual({
      raw: "https://api.example.test:8443/v1/items/?a=1&b#top",
      protocol: "https",
      host: ["api", "example", "test"],
      port: "8443",
      path: ["v1", "items", ""],
      query: [{ key: "a", value: "1" }, { key: "b", value: null }],
      hash: "top",
    });
  });

  it("knows inherited auth and collection variables", () => {
    const c = loaded();
    const chain = authChainFor(c, idOf(c, "Listar productos"));
    expect(chain.map((a) => a?.["type"] ?? null)).toEqual(["bearer", "apikey"]);
    expect(authChainFor(c, idOf(c, "Salud")).map((a) => a?.["type"] ?? null)).toEqual(["bearer"]);
    expect(collectionVariables(c)).toEqual([
      { key: "base", value: "http://127.0.0.1:9", enabled: true },
      { key: "categoria", value: "cafe", enabled: true },
      { key: "viejo", value: "x", enabled: false },
    ]);
  });

  it("saves an auth Sendix cannot edit, such as Digest from a cURL paste, as it came", () => {
    const digest = { type: "digest", digest: [{ key: "username", value: "ana", type: "string" }, { key: "password", value: "pw", type: "string" }] };
    const item = newRequestItem("d-1", "Con Digest", { method: "GET", url: "https://a.test", headers: [], body: { mode: "none" }, auth: { type: "preserved", label: "Digest", data: digest }, settings: DEFAULT_SETTINGS });
    expect((item["request"] as Json)["auth"]).toEqual(digest);
  });

  it("creates, renames, duplicates and removes items", () => {
    const c = loaded();
    const folderId = idOf(c, "Productos");
    expect(insertItem(c, folderId, newRequestItem("new-1", "Obtener producto", { method: "GET", url: "{{base}}/productos/1", headers: [], body: { mode: "none" }, auth: { type: "inherit" }, settings: DEFAULT_SETTINGS }))).toBe(true);
    expect(insertItem(c, idOf(c, "Salud"), newFolder("x", "no"))).toBe(false);
    expect(findItem(c, "new-1")).toMatchObject({ name: "Obtener producto", request: { method: "GET", url: "{{base}}/productos/1" } });
    expect((findItem(c, "new-1")!["request"] as Json)["auth"]).toBeUndefined();

    renameItem(c, "new-1", "Ver producto");
    const copy = duplicateItem(c, folderId, newId)!;
    expect(copy["name"]).toBe("Productos (copia)");
    expect(tree(c).map((n) => n.name)).toEqual(["Productos", "Productos (copia)", "Crear pedido", "Salud"]);
    const copiedIds = tree({ item: [copy] })[0]!.children!.map((n) => n.id);
    expect(copiedIds).not.toContain("new-1");

    expect(removeItem(c, folderId)).toBe(true);
    expect(findItem(c, "new-1")).toBeNull();
  });

  it("reads and writes scripts as v2.1 events, keeping what it does not edit", () => {
    const c = loaded();
    const item = findItem(c, idOf(c, "Listar productos"))!;
    const { request, disabledParams } = itemToRequest(item);
    expect(request.scripts).toEqual({ prerequest: "", test: "pm.test('ok', () => pm.response.to.have.status(200));" });

    // Unchanged scripts leave the event array untouched.
    const before = JSON.stringify(item["event"]);
    applyRequest(item, request, disabledParams);
    expect(JSON.stringify(item["event"])).toBe(before);

    applyRequest(item, { ...request, scripts: { prerequest: 'pm.variables.set("a", 1);\nconsole.log("a");', test: request.scripts!.test } }, disabledParams);
    const events = item["event"] as Json[];
    expect(events.map((e) => e["listen"])).toEqual(["test", "prerequest"]);
    expect((events[1]!["script"] as Json)["exec"]).toEqual(['pm.variables.set("a", 1);', 'console.log("a");']);
    expect((events[0]!["script"] as Json)["type"]).toBe("text/javascript");

    applyRequest(item, { ...request, scripts: { prerequest: "", test: "" } }, disabledParams);
    expect(item["event"]).toBeUndefined();
  });

  it("keeps extra event fields when only the code changes", () => {
    const events = [{ listen: "test", script: { id: "s-1", type: "text/javascript", exec: ["a()"], packages: {} }, disabled: false }];
    const out = scriptsToEvents(events, { prerequest: "", test: "b()\nc()" });
    expect(out).toEqual([{ listen: "test", script: { id: "s-1", type: "text/javascript", exec: ["b()", "c()"], packages: {} }, disabled: false }]);
    expect(scriptsFromEvents(out)).toEqual({ prerequest: "", test: "b()\nc()" });
    expect(scriptsFromEvents([{ listen: "test", script: { exec: "una línea" } }])).toEqual({ prerequest: "", test: "una línea" });
  });

  it("knows the collection and folder scripts that run before a request's own", () => {
    const c = loaded();
    (c["item"] as Json[])[0]!["event"] = [{ listen: "prerequest", script: { exec: ["carpeta()"] } }];
    c["event"] = [{ listen: "prerequest", script: { exec: ["coleccion()"] } }];
    const chain = eventChainFor(c, idOf(c, "Listar productos"));
    expect(chain.map((e) => (e ? scriptsFromEvents(e).prerequest : null))).toEqual(["coleccion()", "carpeta()"]);
    expect(eventChainFor(c, idOf(c, "Salud"))).toHaveLength(1);
  });

  it("stores WebSocket and Socket.IO connections as v2.1 items with x-sendix", () => {
    const rt = {
      ...emptyRealtime("socketio", "{{base}}/pedidos"),
      headers: [{ key: "X-Tienda", value: "cdmx", enabled: true }],
      settings: { ...emptyRealtime("socketio").settings, reconnect: true, auth: '{ "token": "{{token}}" }' },
      messages: [{ name: "Suscribir", body: '{ "canal": "pedidos" }', language: "json" as const, event: "suscribir" }],
    };
    const item = newRealtimeItem("rt-1", "Pedidos", rt);
    expect(item["request"]).toEqual({ method: "GET", url: "{{base}}/pedidos", header: [{ key: "X-Tienda", value: "cdmx" }] });
    expect(isRealtimeItem(item)).toBe(true);
    expect(realtimeFromItem(item)).toEqual(rt);
    expect(tree({ item: [item] })[0]).toMatchObject({ kind: "request", method: "SIO" });

    // Unknown x-sendix keys and other request keys survive an edit.
    (item["x-sendix"] as Json)["futuro"] = 1;
    (item["request"] as Json)["description"] = "Canal de pedidos";
    applyRealtime(item, { ...rt, protocol: "websocket", subprotocols: ["v2"] });
    expect(item["x-sendix"]).toMatchObject({ type: "websocket", subprotocols: ["v2"], futuro: 1 });
    expect((item["request"] as Json)["description"]).toBe("Canal de pedidos");
    expect(isRealtimeItem({ name: "x", request: { url: "http://a" } })).toBe(false);
  });

  it("stores gRPC calls with their definition and lists the files they use", () => {
    const g = {
      ...emptyGrpc("{{grpc}}"),
      definition: { source: "files" as const, files: ["C:/protos/tienda.proto"], importPaths: ["C:/protos"] },
      service: "tienda.v1.Tienda",
      method: "ObtenerProducto",
      message: '{ "id": "prd_1" }',
      metadata: [{ key: "x-tienda", value: "cdmx", enabled: true }],
      settings: { ...emptyGrpc().settings, tls: "tls" as const, caFile: "C:/certs/ca.pem" },
    };
    const item = newGrpcItem("g-1", "Obtener", g);
    expect(item["request"]).toEqual({ method: "POST", url: "{{grpc}}", header: [{ key: "x-tienda", value: "cdmx" }] });
    expect(grpcFromItem(item)).toEqual(g);
    expect(tree({ item: [item] })[0]).toMatchObject({ method: "GRPC" });
    expect(isRealtimeItem(item)).toBe(false);
    expect(grpcPaths({ item: [{ name: "f", item: [item] }] })).toEqual(["C:/protos/tienda.proto", "C:/protos", "C:/certs/ca.pem"]);
  });
});

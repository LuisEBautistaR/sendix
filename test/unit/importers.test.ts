import { describe, expect, it } from "vitest";
import { countRequests, detectImport, harToCollection, normalizeCollection } from "../../src/main/workspace/importers";
import { looksLikeCurl, parseCurl, tokenize } from "@shared/curl";
import { ProviderManager } from "../../src/engine/provider-manager";
import { importerProvider } from "../../src/engine/providers/importer";
import { tree, type Json } from "@shared/collection";

describe("detectImport", () => {
  it("recognises each supported format and explains the rest", () => {
    expect(detectImport('{"info":{"name":"A"},"item":[]}').kind).toBe("collection");
    expect(detectImport('{"name":"Dev","values":[],"_postman_variable_scope":"environment"}').kind).toBe("environment");
    expect(detectImport('{"log":{"entries":[]}}').kind).toBe("har");
    expect(detectImport('{"openapi":"3.0.0","info":{},"paths":{}}').kind).toBe("openapi");
    expect(detectImport("openapi: 3.0.0\ninfo:\n  title: x\n").kind).toBe("openapi");
    expect(detectImport('{"requests":[],"order":[]}')).toMatchObject({ kind: "unknown", reason: expect.stringContaining("v1") });
    expect(detectImport("hola")).toMatchObject({ kind: "unknown" });
  });
});

describe("normalizeCollection", () => {
  it("turns v2.0 auth objects into v2.1 arrays and marks the schema", () => {
    const json: Json = { info: { name: "Vieja", schema: "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" }, auth: { type: "bearer", bearer: { token: "t" } }, item: [{ name: "r", request: { url: "x", auth: { type: "basic", basic: { username: "u", password: "p" } } } }] };
    normalizeCollection(json);
    expect(json["auth"]).toEqual({ type: "bearer", bearer: [{ key: "token", value: "t", type: "string" }] });
    expect(((json["item"] as Json[])[0]!["request"] as Json)["auth"]).toMatchObject({ basic: [{ key: "username", value: "u" }, { key: "password", value: "p" }] });
    expect((json["info"] as Json)["schema"]).toContain("v2.1.0");
  });
});

describe("harToCollection", () => {
  it("groups by host, keeps bodies and drops credentials", () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              method: "post",
              url: "https://api.tienda.test/v1/pedidos?x=1",
              headers: [
                { name: ":authority", value: "api.tienda.test" },
                { name: "Content-Type", value: "application/json" },
                { name: "Authorization", value: "Bearer secreto" },
                { name: "Cookie", value: "sid=1" },
              ],
              postData: { mimeType: "application/json", text: '{"a":1}' },
            },
          },
          { request: { method: "GET", url: "https://cdn.tienda.test/logo.png", headers: [] } },
        ],
      },
    };
    const { collection, count, notes } = harToCollection(har, "captura");
    expect(count).toBe(2);
    expect(tree(collection).map((f) => f.name)).toEqual(["api.tienda.test", "cdn.tienda.test"]);
    const req = (((collection["item"] as Json[])[0]!["item"] as Json[])[0]!["request"]) as Json;
    expect(req).toMatchObject({ method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: '{"a":1}' } });
    expect(JSON.stringify(collection)).not.toContain("secreto");
    expect(notes[0]).toContain("2 cabeceras");
    expect(countRequests(collection)).toBe(2);
  });
});

describe("OpenAPI import (engine)", () => {
  it("converts a definition into a v2.1 collection", async () => {
    const manager = new ProviderManager([importerProvider], { testMode: false, emit: () => {} });
    const yaml = [
      "openapi: 3.0.0",
      "info: { title: Tienda, version: '1' }",
      "servers: [{ url: 'https://api.tienda.test/v1' }]",
      "paths:",
      "  /productos:",
      "    get: { summary: Listar productos, tags: [Productos], responses: { '200': { description: ok } } }",
      "    post: { summary: Crear producto, tags: [Productos], responses: { '201': { description: creado } } }",
    ].join("\n");
    const { collection } = (await manager.invoke("import.openapi", { text: yaml }, { id: "1", signal: new AbortController().signal })) as { collection: Json };
    expect((collection["info"] as Json)["name"]).toBe("Tienda");
    expect(countRequests(collection)).toBe(2);
    expect(JSON.stringify(collection)).toContain("Listar productos");
  }, 30_000);

  it("rejects invalid definitions with a reason", async () => {
    const manager = new ProviderManager([importerProvider], { testMode: false, emit: () => {} });
    await expect(manager.invoke("import.openapi", { text: '{"openapi":"3.0.0"}' }, { id: "1", signal: new AbortController().signal })).rejects.toThrow();
  });
});

describe("cURL", () => {
  it("tokenises bash and Windows quoting with line continuations", () => {
    expect(tokenize(`curl -H 'A: b c' "x \\"y\\"" \\\n  --data a=1`)).toEqual(["curl", "-H", "A: b c", 'x "y"', "--data", "a=1"]);
    expect(tokenize(`curl ^\n https://a.test`)).toEqual(["curl", "https://a.test"]);
  });

  it("imports a typical JSON POST with bearer auth", () => {
    const parsed = parseCurl(`curl -X POST 'https://api.tienda.test/v1/pedidos' -H 'Authorization: Bearer abc' -H 'Content-Type: application/json' --data-raw '{"producto":"p1"}' -k --compressed`)!;
    expect(parsed.request).toMatchObject({
      method: "POST",
      url: "https://api.tienda.test/v1/pedidos",
      headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
      body: { mode: "raw", language: "json", raw: '{"producto":"p1"}' },
      auth: { type: "bearer", token: "abc" },
      settings: { verifyTls: false },
    });
    expect(parsed.notes).toEqual([]);
  });

  it("handles forms, basic auth, -G and unknown options", () => {
    const form = parseCurl("curl https://a.test/login -d user=ana -d 'clave=caf%C3%A9' -u ana:pw --frobnicate")!;
    expect(form.request.method).toBe("POST");
    expect(form.request.body).toEqual({ mode: "urlencoded", fields: [{ key: "user", value: "ana", enabled: true }, { key: "clave", value: "café", enabled: true }] });
    expect(form.request.auth).toEqual({ type: "basic", username: "ana", password: "pw" });
    expect(form.notes).toEqual(["Se ignoró la opción --frobnicate."]);

    const get = parseCurl("curl -G https://a.test/buscar --data-urlencode 'q=café con leche'")!;
    expect(get.request).toMatchObject({ method: "GET", url: "https://a.test/buscar?q=caf%C3%A9%20con%20leche", body: { mode: "none" } });

    const multipart = parseCurl("curl -F nombre=Ana -F foto=@yo.png https://a.test/perfil")!;
    expect(multipart.request.body).toEqual({ mode: "formdata", fields: [{ key: "nombre", value: "Ana", enabled: true }] });
    expect(multipart.notes[0]).toContain("foto");
  });

  it("only reacts to curl commands", () => {
    expect(looksLikeCurl("  curl https://a.test")).toBe(true);
    expect(looksLikeCurl("https://curl.se")).toBe(false);
    expect(parseCurl("curl -s")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { ensureSendixProtocol, linkFromArgv, mockixImportLink, parseSendixLink } from "@shared/links";

/** Builds the link exactly as Mockix's «Abrir en Sendix» does. */
function mockixLink(req: { method: string; url: string; body?: string; headers?: Record<string, string> }) {
  const q = new URLSearchParams({ method: req.method, url: req.url });
  if (req.body) q.set("body", req.body);
  if (req.headers && Object.keys(req.headers).length) q.set("headers", JSON.stringify(req.headers));
  return `sendix://request?${q.toString()}`;
}

describe("parseSendixLink", () => {
  it("reads the request Mockix sends", () => {
    const link = mockixLink({
      method: "POST",
      url: "http://127.0.0.1:3000/pedidos?pagina=2&orden=fecha desc",
      body: '{ "producto": "Café de Veracruz", "cantidad": 2 }',
      headers: { "Content-Type": "application/json", "X-Clave": "a&b=c" },
    });
    expect(parseSendixLink(link)).toEqual({
      ok: true,
      request: {
        method: "POST",
        url: "http://127.0.0.1:3000/pedidos?pagina=2&orden=fecha desc",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "X-Clave", value: "a&b=c" },
        ],
        body: '{ "producto": "Café de Veracruz", "cantidad": 2 }',
      },
    });
  });

  it("works without headers or body, and with sendix:///request", () => {
    expect(parseSendixLink("sendix://request?method=GET&url=https%3A%2F%2Fapi.ejemplo.test%2Fsalud")).toEqual({
      ok: true,
      request: { method: "GET", url: "https://api.ejemplo.test/salud", headers: [], body: null },
    });
    expect(parseSendixLink("sendix:///request?method=GET&url=http%3A%2F%2Flocalhost%3A8080%2F").ok).toBe(true);
  });

  it.each([
    ["another scheme", "mockix://request?method=GET&url=http%3A%2F%2Fa.test%2F"],
    ["an unknown action", "sendix://send?method=GET&url=http%3A%2F%2Fa.test%2F"],
    ["a method outside the list", "sendix://request?method=TRACE&url=http%3A%2F%2Fa.test%2F"],
    ["a non-HTTP URL", "sendix://request?method=GET&url=file%3A%2F%2F%2FC%3A%2Fsecreto.txt"],
    ["a javascript: URL", "sendix://request?method=GET&url=javascript%3Aalert(1)"],
    ["a missing URL", "sendix://request?method=GET"],
    ["headers that are not JSON", "sendix://request?method=GET&url=http%3A%2F%2Fa.test%2F&headers=nope"],
    ["headers that are not an object of strings", `sendix://request?method=GET&url=http%3A%2F%2Fa.test%2F&headers=${encodeURIComponent('{"X":1}')}`],
    ["an invalid header name", `sendix://request?method=GET&url=http%3A%2F%2Fa.test%2F&headers=${encodeURIComponent('{"Mal nombre":"x"}')}`],
    ["a repeated parameter", "sendix://request?method=GET&method=POST&url=http%3A%2F%2Fa.test%2F"],
    ["a body over 64 KB", `sendix://request?method=POST&url=http%3A%2F%2Fa.test%2F&body=${"x".repeat(64 * 1024 + 1)}`],
    ["text that is not a URL", "no es un enlace"],
  ])("refuses %s", (_label, link) => {
    expect(parseSendixLink(link)).toMatchObject({ ok: false });
  });

  it("refuses more than 50 headers", () => {
    const headers = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`X-H${i}`, "v"]));
    expect(parseSendixLink(mockixLink({ method: "GET", url: "http://a.test/", headers })).ok).toBe(false);
  });
});

describe("linkFromArgv", () => {
  it("finds the link Windows passes as an argument", () => {
    expect(linkFromArgv(["C:\\Sendix\\Sendix.exe", "--flag", "sendix://request?method=GET&url=x"])).toBe("sendix://request?method=GET&url=x");
    expect(linkFromArgv(["C:\\Sendix\\Sendix.exe", "SENDIX://request"])).toBe("SENDIX://request");
    expect(linkFromArgv(["C:\\Sendix\\Sendix.exe", "."])).toBeNull();
  });
});

describe("ensureSendixProtocol", () => {
  it("registers sendix:// again only when it no longer points to this app", () => {
    const calls: string[] = [];
    const registry = (current: boolean) => ({
      isDefaultProtocolClient: (scheme: string) => (calls.push(`is ${scheme}`), current),
      setAsDefaultProtocolClient: (scheme: string) => (calls.push(`set ${scheme}`), true),
    });
    expect(ensureSendixProtocol(registry(true))).toBe(false);
    expect(calls).toEqual(["is sendix"]);
    calls.length = 0;
    expect(ensureSendixProtocol(registry(false))).toBe(true);
    expect(calls).toEqual(["is sendix", "set sendix"]);
  });
});

describe("mockixImportLink", () => {
  it("passes the collection file and, when it is a Mockix workspace, the folder", () => {
    const file = "C:\\Users\\ana\\api tienda\\collections\\Tienda.postman_collection.json";
    const plain = new URL(mockixImportLink(file, null));
    expect(plain.protocol).toBe("mockix:");
    expect(plain.hostname).toBe("import");
    expect(Object.fromEntries(plain.searchParams)).toEqual({ collection: file });
    const withWs = new URL(mockixImportLink(file, "C:\\Users\\ana\\api tienda"));
    expect(withWs.searchParams.get("workspace")).toBe("C:\\Users\\ana\\api tienda");
  });
});

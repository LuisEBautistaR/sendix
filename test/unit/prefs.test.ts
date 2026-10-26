import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, applyRequestPrefs, bypassesProxy, clientCertFor, parseProxyServer, prefsSchema, readPrefs } from "@shared/prefs";
import { DEFAULT_SETTINGS, type HttpRequest } from "@shared/http";

const request = (patch: Partial<HttpRequest> = {}): HttpRequest => ({
  method: "GET",
  url: "https://api.ejemplo.test/productos",
  headers: [],
  body: { mode: "none" },
  auth: { type: "none" },
  settings: { ...DEFAULT_SETTINGS },
  ...patch,
});

describe("readPrefs", () => {
  it("returns the defaults for a first run or a broken file", () => {
    expect(readPrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(readPrefs("oscuro")).toEqual(DEFAULT_PREFS);
    expect(readPrefs([])).toEqual(DEFAULT_PREFS);
  });

  it("keeps valid fields and replaces each invalid one with its default", () => {
    const prefs = readPrefs({
      theme: "dark",
      editor: { fontSize: 40, tabSize: 4, closeBrackets: false },
      request: { timeoutMs: 45_000, verifyTls: "no", maxResponseMb: 120 },
    });
    expect(prefs.theme).toBe("dark");
    expect(prefs.editor).toEqual({ fontSize: DEFAULT_PREFS.editor.fontSize, tabSize: 4, closeBrackets: false });
    expect(prefs.request).toEqual({ ...DEFAULT_PREFS.request, timeoutMs: 45_000, maxResponseMb: 120 });
    expect(prefsSchema.safeParse(prefs).success).toBe(true);
  });

  it("ignores an unknown theme", () => {
    expect(readPrefs({ theme: "dracula" }).theme).toBe("system");
  });

  it("does not share objects with the defaults", () => {
    const prefs = readPrefs({});
    prefs.request.timeoutMs = 1_000;
    expect(DEFAULT_PREFS.request.timeoutMs).toBe(30_000);
  });
});

describe("applyRequestPrefs", () => {
  it("leaves the request alone with the default preferences", () => {
    const r = request({ headers: [{ key: "Accept", value: "application/json", enabled: true }] });
    expect(applyRequestPrefs(r, DEFAULT_PREFS.request)).toEqual(r);
  });

  it("global switches can only turn verification and redirects off", () => {
    const off = { ...DEFAULT_PREFS.request, verifyTls: false, followRedirects: false };
    expect(applyRequestPrefs(request(), off).settings).toMatchObject({ verifyTls: false, followRedirects: false });
    const own = request({ settings: { ...DEFAULT_SETTINGS, verifyTls: false, followRedirects: false } });
    expect(applyRequestPrefs(own, DEFAULT_PREFS.request).settings).toMatchObject({ verifyTls: false, followRedirects: false });
  });

  it("adds Cache-Control: no-cache unless the request already sets it", () => {
    const prefs = { ...DEFAULT_PREFS.request, sendNoCache: true };
    expect(applyRequestPrefs(request(), prefs).headers).toEqual([{ key: "Cache-Control", value: "no-cache", enabled: true }]);
    const own = request({ headers: [{ key: "cache-control", value: "max-age=60", enabled: true }] });
    expect(applyRequestPrefs(own, prefs).headers).toEqual(own.headers);
    // A disabled header does not count: it is not sent.
    const disabled = request({ headers: [{ key: "Cache-Control", value: "max-age=60", enabled: false }] });
    expect(applyRequestPrefs(disabled, prefs).headers).toHaveLength(2);
  });
});

describe("network helpers", () => {
  it("reads proxy servers written with or without scheme", () => {
    expect(parseProxyServer("proxy.empresa.test:3128")).toEqual({ host: "proxy.empresa.test", port: 3128 });
    expect(parseProxyServer("http://10.0.0.5:8080")).toEqual({ host: "10.0.0.5", port: 8080 });
    expect(parseProxyServer("proxy.empresa.test")).toEqual({ host: "proxy.empresa.test", port: 80 });
    expect(parseProxyServer("socks5://x:1080")).toBeNull();
    expect(parseProxyServer("")).toBeNull();
  });

  it("matches proxy exceptions", () => {
    const bypass = "localhost, *.interno.test; .corp.test 10.0.0.1";
    expect(bypassesProxy("localhost", bypass)).toBe(true);
    expect(bypassesProxy("api.interno.test", bypass)).toBe(true);
    expect(bypassesProxy("interno.test", bypass)).toBe(false);
    expect(bypassesProxy("corp.test", bypass)).toBe(true);
    expect(bypassesProxy("a.corp.test", bypass)).toBe(true);
    expect(bypassesProxy("10.0.0.1", bypass)).toBe(true);
    expect(bypassesProxy("api.ejemplo.test", bypass)).toBe(false);
    expect(bypassesProxy("cualquiera", "*")).toBe(true);
  });

  it("picks the client certificate for the exact host and port", () => {
    const certs = [
      { id: "a", host: "api.empresa.test", certFile: "a.crt", keyFile: "a.key", pfxFile: null },
      { id: "b", host: "api.empresa.test:8443", certFile: null, keyFile: null, pfxFile: "b.pfx" },
    ];
    expect(clientCertFor("https://api.empresa.test/x", certs)?.id).toBe("a");
    expect(clientCertFor("https://API.empresa.test:443/x", certs)?.id).toBe("a");
    expect(clientCertFor("https://api.empresa.test:8443/x", certs)?.id).toBe("b");
    expect(clientCertFor("https://api.empresa.test:9443/x", certs)).toBeNull();
    expect(clientCertFor("http://api.empresa.test/x", certs)).toBeNull();
    expect(clientCertFor("{{base}}/x", certs)).toBeNull();
  });

  it("network preferences fall back to defaults as a whole when invalid", () => {
    expect(readPrefs({ network: { proxy: { mode: "socks" } } }).network).toEqual(DEFAULT_PREFS.network);
    const ok = { ...DEFAULT_PREFS.network, caFile: "C:/ca.pem" };
    expect(readPrefs({ network: ok }).network).toEqual(ok);
  });
});

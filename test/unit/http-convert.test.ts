import { describe, expect, it } from "vitest";
import { computeTimings, mapCookies, toCollectionItem } from "../../src/engine/http/convert";
import { DEFAULT_SETTINGS, type HttpRequest } from "@shared/http";

const req = (over: Partial<HttpRequest> = {}): HttpRequest => ({
  method: "post",
  url: "https://api.example.test/v1/items",
  headers: [],
  body: { mode: "none" },
  auth: { type: "none" },
  settings: DEFAULT_SETTINGS,
  ...over,
});

describe("toCollectionItem", () => {
  it("upper-cases the method, keeps enabled headers and adds a User-Agent only when missing", () => {
    const item = toCollectionItem(req({ headers: [{ key: " X-A ", value: "1", enabled: true }, { key: "X-B", value: "2", enabled: false }, { key: "", value: "x", enabled: true }] }), "Sendix/1");
    expect(item).toMatchObject({ request: { method: "POST", header: [{ key: "X-A", value: "1" }, { key: "User-Agent", value: "Sendix/1" }] } });
    const own = toCollectionItem(req({ headers: [{ key: "user-agent", value: "mine", enabled: true }] }), "Sendix/1");
    expect((own["request"] as { header: unknown[] }).header).toEqual([{ key: "user-agent", value: "mine" }]);
  });

  it("adds the content type for raw bodies unless the user set one", () => {
    const item = toCollectionItem(req({ body: { mode: "raw", language: "xml", raw: "<a/>" } }), "S");
    expect((item["request"] as { header: unknown[] }).header).toContainEqual({ key: "Content-Type", value: "application/xml" });
    const own = toCollectionItem(req({ headers: [{ key: "Content-Type", value: "text/csv", enabled: true }], body: { mode: "raw", language: "text", raw: "a,b" } }), "S");
    expect((own["request"] as { header: Array<{ key: string }> }).header.filter((h) => h.key.toLowerCase() === "content-type")).toHaveLength(1);
  });

  it("maps every auth type to the v2.1 shape", () => {
    expect(toCollectionItem(req(), "S")).toMatchObject({ request: { auth: { type: "noauth" } } });
    expect(toCollectionItem(req({ auth: { type: "basic", username: "u", password: "p" } }), "S")).toMatchObject({
      request: { auth: { type: "basic", basic: [{ key: "username", value: "u" }, { key: "password", value: "p" }] } },
    });
    expect(toCollectionItem(req({ auth: { type: "apikey", key: "k", value: "v", in: "header" } }), "S")).toMatchObject({
      request: { auth: { type: "apikey", apikey: [{ key: "key", value: "k" }, { key: "value", value: "v" }, { key: "in", value: "header" }] } },
    });
  });
});

describe("computeTimings", () => {
  it("splits a fresh TLS connection into phases", () => {
    const t = computeTimings([{ request: 1, socket: 2, lookup: 6, connect: 16, secureConnect: 40, response: 100, end: 120 }], 0);
    expect(t).toEqual({ dns: 4, tcp: 10, tls: 24, wait: 60, download: 20, redirects: 0, total: 119 });
  });

  it("reports a reused socket as zero dns/tcp and sums earlier redirect hops", () => {
    const t = computeTimings(
      [
        { request: 10, socket: 13, lookup: 13, connect: 15, response: 18, end: 19 },
        { request: 21, socket: 22, lookup: 22, connect: 22, response: 23, end: 27 },
      ],
      0,
    );
    expect(t).toMatchObject({ dns: 0, tcp: 0, tls: 0, wait: 1, download: 4, redirects: 11, total: 17 });
  });

  it("falls back to the elapsed time when offsets are missing", () => {
    expect(computeTimings([], 42)).toMatchObject({ wait: 42, total: 42, dns: 0 });
  });
});

describe("mapCookies", () => {
  it("accepts SDK lists and ignores malformed entries", () => {
    const list = { toJSON: () => [{ name: "sid", value: "1", httpOnly: true, domain: "a.test", path: "/", expires: new Date(0) }, null, { value: "nameless" }] };
    expect(mapCookies(list)).toEqual([{ name: "sid", value: "1", httpOnly: true, secure: false, domain: "a.test", path: "/", expires: "1970-01-01T00:00:00.000Z" }]);
    expect(mapCookies(undefined)).toEqual([]);
  });
});

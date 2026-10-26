import { describe, expect, it } from "vitest";
import { applyRequest, behaviorChainFor, itemToRequest, settingsFromBehavior } from "@shared/collection";
import { DEFAULT_SETTINGS, type HttpRequest } from "@shared/http";
import { toCollection, toCollectionItem } from "../../src/engine/http/convert";
import { firstProxy } from "../../src/main/prefs";

const request = (settings: Partial<HttpRequest["settings"]> = {}): HttpRequest => ({
  method: "GET",
  url: "https://api.ejemplo.test/x",
  headers: [],
  body: { mode: "none" },
  auth: { type: "none" },
  settings: { ...DEFAULT_SETTINGS, ...settings },
});

describe("request behaviour in protocolProfileBehavior", () => {
  it("reads only well-typed values", () => {
    expect(settingsFromBehavior({ maxRedirects: 3, disableCookies: true, followAuthorizationHeader: "sí", strictSSL: false })).toEqual({
      ...DEFAULT_SETTINGS,
      verifyTls: false,
      maxRedirects: 3,
      disableCookies: true,
    });
    expect(settingsFromBehavior({ maxRedirects: -1 })).toEqual(DEFAULT_SETTINGS);
  });

  it("saves set values, drops inherited ones and keeps keys Sendix does not edit", () => {
    const item: Record<string, unknown> = {
      name: "x",
      request: { method: "GET", url: "https://api.ejemplo.test/x" },
      protocolProfileBehavior: { disableBodyPruning: true, maxRedirects: 9, disableCookies: true },
    };
    const loaded = itemToRequest(item).request;
    applyRequest(item, { ...loaded, settings: { ...loaded.settings, maxRedirects: 2, disableCookies: undefined, followOriginalHttpMethod: false } }, []);
    expect(item["protocolProfileBehavior"]).toEqual({ disableBodyPruning: true, maxRedirects: 2, followOriginalHttpMethod: false });
  });

  it("the engine writes the item's own behaviour; off switches always win", () => {
    expect(toCollectionItem(request(), "Sendix/1")["protocolProfileBehavior"]).toBeUndefined();
    expect(toCollectionItem(request({ verifyTls: false, maxRedirects: 0 }), "Sendix/1")["protocolProfileBehavior"]).toEqual({ maxRedirects: 0, strictSSL: false });
  });

  it("collection and folder behaviour wrap the item for postman-runtime to resolve", () => {
    const collection = {
      info: { name: "C" },
      protocolProfileBehavior: { maxRedirects: 0 },
      item: [{ id: "f", name: "F", protocolProfileBehavior: { disableCookies: true }, item: [{ id: "r", name: "R", request: {} }] }],
    };
    const chain = behaviorChainFor(collection, "r");
    expect(chain).toEqual([{ maxRedirects: 0 }, { disableCookies: true }]);
    const wrapped = toCollection({ name: "R" }, { authChain: [null, null], eventChain: [null, null], behaviorChain: chain, collectionVariables: [], environment: [] });
    expect(wrapped["protocolProfileBehavior"]).toEqual({ maxRedirects: 0 });
    expect((wrapped["item"] as Array<Record<string, unknown>>)[0]!["protocolProfileBehavior"]).toEqual({ disableCookies: true });
  });
});

describe("firstProxy", () => {
  it("reads the first proxy of a PAC answer", () => {
    expect(firstProxy("PROXY proxy.empresa.test:3128; DIRECT")).toEqual({ host: "proxy.empresa.test", port: 3128 });
    expect(firstProxy("HTTPS [::1]:8443")).toEqual({ host: "::1", port: 8443 });
    expect(firstProxy("DIRECT")).toBeNull();
    expect(firstProxy("SOCKS5 s:1080; PROXY p:80")).toEqual({ host: "p", port: 80 });
  });
});

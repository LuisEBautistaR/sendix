import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderManager } from "../../src/engine/provider-manager";
import { httpProvider } from "../../src/engine/providers/http";
import { DEFAULT_SETTINGS, type HttpOutcome, type HttpRequest } from "@shared/http";
import type { MethodParams } from "@shared/methods";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
const manager = new ProviderManager([httpProvider], { testMode: false, emit: () => {} });
let n = 0;

const base = (over: Partial<HttpRequest> = {}): HttpRequest => ({
  method: "GET",
  url: `${server.url}/json`,
  headers: [],
  body: { mode: "none" },
  auth: { type: "none" },
  settings: DEFAULT_SETTINGS,
  ...over,
});

const send = (request: HttpRequest, requestId = `test-req-${++n}`, signal = new AbortController().signal) =>
  manager.invoke("http.send", { requestId, request }, { id: requestId, signal }) as Promise<HttpOutcome>;

const bodyJson = (o: HttpOutcome) => {
  if (o.kind !== "response") throw new Error(`expected a response, got ${o.kind}`);
  return JSON.parse(new TextDecoder().decode(o.response.body));
};

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

describe("http provider", () => {
  it("sends a GET and returns status, headers, cookies, body and timings", async () => {
    const outcome = await send(base());
    expect(outcome.kind).toBe("response");
    if (outcome.kind !== "response") return;
    const { response } = outcome;
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(response.headers.find((h) => h.key.toLowerCase() === "content-type")?.value).toMatch(/application\/json/);
    expect(response.cookies).toMatchObject([{ name: "sid", value: "abc123", httpOnly: true }]);
    expect(bodyJson(outcome).total).toBe(1);
    expect(response.sizes.body).toBe(response.body.byteLength);
    expect(response.timings.total).toBeGreaterThan(0);
    expect(response.timings.total).toBeGreaterThanOrEqual(response.timings.wait);
  });

  it("sends its own User-Agent and no tracking headers", async () => {
    const echo = bodyJson(await send(base({ url: `${server.url}/echo` })));
    expect(echo.headers["user-agent"]).toMatch(/^Sendix\//);
    expect(echo.headers["postman-token"]).toBeUndefined();
    expect(echo.headers["cache-control"]).toBeUndefined();
  });

  it("applies enabled headers, JSON body with its content type, and bearer auth", async () => {
    const echo = bodyJson(
      await send(
        base({
          method: "POST",
          url: `${server.url}/echo?a=1`,
          headers: [
            { key: "X-Uno", value: "1", enabled: true },
            { key: "X-Off", value: "no", enabled: false },
          ],
          body: { mode: "raw", language: "json", raw: '{"nombre":"Café"}' },
          auth: { type: "bearer", token: "tok-123" },
        }),
      ),
    );
    expect(echo.method).toBe("POST");
    expect(echo.query).toEqual({ a: "1" });
    expect(echo.headers["x-uno"]).toBe("1");
    expect(echo.headers["x-off"]).toBeUndefined();
    expect(echo.headers["content-type"]).toBe("application/json");
    expect(echo.headers["authorization"]).toBe("Bearer tok-123");
    expect(JSON.parse(echo.body)).toEqual({ nombre: "Café" });
  });

  it("sends url-encoded forms and API keys in the query", async () => {
    const echo = bodyJson(
      await send(
        base({
          method: "POST",
          url: `${server.url}/echo`,
          body: { mode: "urlencoded", fields: [{ key: "q", value: "café con leche", enabled: true }] },
          auth: { type: "apikey", key: "api_key", value: "k1", in: "query" },
        }),
      ),
    );
    expect(echo.body).toBe("q=caf%C3%A9%20con%20leche");
    expect(echo.query).toEqual({ api_key: "k1" });
  });

  it("follows redirects and reports them, or stops when asked", async () => {
    const followed = await send(base({ url: `${server.url}/redirect` }));
    expect(followed).toMatchObject({ kind: "response", response: { status: 200, redirectCount: 1 } });
    const stopped = await send(base({ url: `${server.url}/redirect`, settings: { ...DEFAULT_SETTINGS, followRedirects: false } }));
    expect(stopped).toMatchObject({ kind: "response", response: { status: 302, redirectCount: 0 } });
  });

  it("returns 4xx/5xx as responses, not errors", async () => {
    expect(await send(base({ url: `${server.url}/status/422` }))).toMatchObject({ kind: "response", response: { status: 422 } });
  });

  it("reports network errors with their code", async () => {
    const closed = await startTestServer();
    const url = closed.url;
    await closed.close();
    expect(await send(base({ url: `${url}/json` }))).toMatchObject({ kind: "error", code: "ECONNREFUSED" });
  });

  it("times out according to the request settings", async () => {
    const outcome = await send(base({ url: `${server.url}/slow?ms=3000`, settings: { ...DEFAULT_SETTINGS, timeoutMs: 1_000 } }));
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") expect(outcome.code).toMatch(/TIMEDOUT/);
  });

  it("cancels an in-flight request", async () => {
    const pending = send(base({ url: `${server.url}/slow?ms=5000` }), "cancel-me-1");
    await new Promise((r) => setTimeout(r, 200));
    expect(await manager.invoke("http.cancel", { requestId: "cancel-me-1" }, { id: "x", signal: new AbortController().signal })).toEqual({ cancelled: true });
    expect(await pending).toMatchObject({ kind: "cancelled" });
  });
});

describe("http provider with workspace context", () => {
  it("resolves environment and collection variables, environment first", async () => {
    const echo = bodyJson(
      await manager.invoke(
        "http.send",
        {
          requestId: "ctx-vars-1",
          request: base({ url: "{{base}}/echo?cat={{categoria}}&env={{entorno}}", auth: { type: "inherit" } }),
          context: {
            authChain: [null],
            eventChain: [null],
            collectionVariables: [
              { key: "base", value: server.url, enabled: true },
              { key: "categoria", value: "de-coleccion", enabled: true },
            ],
            environment: [
              { key: "categoria", value: "del-entorno", enabled: true },
              { key: "entorno", value: "dev", enabled: true },
            ],
          },
        },
        { id: "x", signal: new AbortController().signal },
      ) as HttpOutcome,
    );
    expect(echo.query).toEqual({ cat: "del-entorno", env: "dev" });
  });

  it("inherits the nearest folder auth, falling back to the collection", async () => {
    const send = (authChain: Array<Record<string, unknown> | null>, auth: HttpRequest["auth"] = { type: "inherit" }) =>
      manager.invoke(
        "http.send",
        {
          requestId: `ctx-auth-${++n}`,
          request: base({ url: `${server.url}/echo`, auth }),
          context: { authChain, eventChain: [], collectionVariables: [], environment: [{ key: "token", value: "tok-env", enabled: true }] },
        },
        { id: "x", signal: new AbortController().signal },
      ) as Promise<HttpOutcome>;
    const bearer = { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] };
    const apikey = { type: "apikey", apikey: [{ key: "key", value: "X-Clave" }, { key: "value", value: "k-1" }, { key: "in", value: "header" }] };

    const fromCollection = bodyJson(await send([bearer, null]));
    expect(fromCollection.headers["authorization"]).toBe("Bearer tok-env");

    const fromFolder = bodyJson(await send([bearer, apikey]));
    expect(fromFolder.headers["x-clave"]).toBe("k-1");
    expect(fromFolder.headers["authorization"]).toBeUndefined();

    const explicitNone = bodyJson(await send([bearer], { type: "none" }));
    expect(explicitNone.headers["authorization"]).toBeUndefined();
  });
});

describe("http provider scripts", () => {
  const ev = (listen: "prerequest" | "test", code: string) => [{ listen, script: { type: "text/javascript", exec: code.split("\n") } }];
  const withContext = (request: HttpRequest, context: Partial<NonNullable<MethodParams<"http.send">["context"]>> = {}) =>
    manager.invoke(
      "http.send",
      {
        requestId: `scripts-${++n}`,
        request,
        context: { authChain: [], eventChain: [], collectionVariables: [], environment: [], ...context },
      },
      { id: "x", signal: new AbortController().signal },
    ) as Promise<HttpOutcome>;

  it("runs pre-request and test scripts, with test results and console", async () => {
    const outcome = await send(
      base({
        url: `${server.url}/echo`,
        scripts: {
          prerequest: 'pm.request.headers.add({ key: "X-Desde-Script", value: "si" });\nconsole.log("antes", { n: 1 });',
          test: 'pm.test("status 200", () => pm.response.to.have.status(200));\npm.test("falla", () => pm.expect(1).to.equal(2));\nconsole.warn("despues");',
        },
      }),
    );
    expect(bodyJson(outcome).headers["x-desde-script"]).toBe("si");
    expect(outcome.scripts?.tests).toEqual([
      { name: "status 200", passed: true, skipped: false, error: null },
      { name: "falla", passed: false, skipped: false, error: expect.stringContaining("expected 1 to equal 2") },
    ]);
    expect(outcome.scripts?.console).toEqual([
      { level: "log", text: "antes { n: 1 }" },
      { level: "warn", text: "despues" },
    ]);
  });

  it("reports variables set by scripts as session changes", async () => {
    const outcome = await withContext(
      base({ url: `${server.url}/json`, scripts: { prerequest: "", test: 'pm.environment.set("primero", pm.response.json().productos[0].id);\npm.collectionVariables.set("visto", "1");\npm.environment.unset("viejo");' } }),
      { environment: [{ key: "viejo", value: "x", enabled: true }] },
    );
    expect(outcome.session).toEqual({ environment: [{ key: "primero", value: "prd_1" }, { key: "viejo", value: null }], collection: [{ key: "visto", value: "1" }] });
  });

  it("runs collection and folder scripts before the request's own, in order", async () => {
    const outcome = await withContext(base({ url: `${server.url}/json`, scripts: { prerequest: 'console.log("peticion")', test: "" } }), {
      eventChain: [ev("prerequest", 'console.log("coleccion")'), null, ev("prerequest", 'console.log("carpeta")')],
    });
    expect(outcome.scripts?.console.map((c) => c.text)).toEqual(["coleccion", "carpeta", "peticion"]);
  });

  it("does not send the request when the pre-request script throws", async () => {
    const outcome = await send(base({ url: `${server.url}/echo`, scripts: { prerequest: 'throw new Error("sin token")', test: "" } }));
    expect(outcome).toMatchObject({ kind: "error", code: "SCRIPT_ERROR", message: expect.stringContaining("sin token") });
    expect(outcome.scripts?.errors).toEqual([{ phase: "prerequest", message: expect.stringContaining("sin token") }]);
  });

  it("masks secret values in console output and test names", async () => {
    const outcome = await withContext(
      base({ url: `${server.url}/json`, scripts: { prerequest: 'console.log("token=" + pm.environment.get("token"))', test: 'pm.test("usa " + pm.environment.get("token"), () => {})' } }),
      { environment: [{ key: "token", value: "tok-muy-secreto", enabled: true, secret: true }] },
    );
    const text = JSON.stringify(outcome.scripts);
    expect(text).not.toContain("tok-muy-secreto");
    expect(outcome.scripts?.console[0]?.text).toBe("token=••••••••");
  });
});

describe("http provider iteration data", () => {
  it("resolves data columns in the URL and exposes pm.iterationData", async () => {
    const outcome = (await manager.invoke(
      "http.send",
      {
        requestId: `data-${++n}`,
        request: base({ url: `${server.url}/echo?u={{usuario}}`, scripts: { prerequest: "", test: 'console.log(pm.iterationData.get("edad"))' } }),
        iterationData: { usuario: "ana", edad: 31 },
      },
      { id: "x", signal: new AbortController().signal },
    )) as HttpOutcome;
    expect(bodyJson(outcome).query).toEqual({ u: "ana" });
    expect(outcome.scripts?.console[0]?.text).toBe("31");
  });
});

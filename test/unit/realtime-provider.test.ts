import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderManager } from "../../src/engine/provider-manager";
import { realtimeProvider } from "../../src/engine/providers/realtime";
import { emptyRealtime, realtimeUrl, type ConnectResult, type RealtimeEvent, type RealtimeRequest } from "@shared/realtime";
import type { SendContext } from "@shared/http";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
const events: RealtimeEvent[] = [];
const manager = new ProviderManager([realtimeProvider], { testMode: false, emit: (_stream, _name, data) => events.push(data as RealtimeEvent) });
let n = 0;
const call = { id: "x", signal: new AbortController().signal };

const connect = (request: RealtimeRequest, context: SendContext | null = null) => {
  const connId = `conn-test-${++n}`;
  return manager.invoke("realtime.connect", { connId, request, context }, call).then((r) => ({ connId, result: r as ConnectResult }));
};
const send = (connId: string, body: string, extra: Partial<{ event: string; ack: boolean; language: "json" | "text" }> = {}) =>
  manager.invoke("realtime.send", { connId, message: { body, language: "text", event: "", ack: false, ...extra } }, call) as Promise<{ sent: boolean; error: string | null }>;
const close = (connId: string) => manager.invoke("realtime.close", { connId }, call);

const of = (connId: string) => events.filter((e) => e.connId === connId);
async function waitFor<T extends RealtimeEvent>(connId: string, match: (e: RealtimeEvent) => e is T, count = 1, timeoutMs = 8000): Promise<T[]> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = of(connId).filter(match);
    if (found.length >= count) return found;
    if (Date.now() > until) throw new Error(`Timed out waiting for events on ${connId}: ${JSON.stringify(of(connId))}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const isIn = (e: RealtimeEvent): e is Extract<RealtimeEvent, { type: "message" }> => e.type === "message" && e.message.dir === "in";
const isClosed = (e: RealtimeEvent): e is Extract<RealtimeEvent, { type: "closed" }> => e.type === "closed";
const isOpen = (e: RealtimeEvent): e is Extract<RealtimeEvent, { type: "open" }> => e.type === "open";

const context = (over: Partial<SendContext> = {}): SendContext => ({ authChain: [], eventChain: [], collectionVariables: [], environment: [], ...over });

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

describe("realtime URLs", () => {
  it("adds or converts the scheme for each protocol", () => {
    expect(realtimeUrl("localhost:3000/ws", "websocket")).toBe("ws://localhost:3000/ws");
    expect(realtimeUrl("https://api.test/ws", "websocket")).toBe("wss://api.test/ws");
    expect(realtimeUrl("wss://api.test", "socketio")).toBe("https://api.test");
    expect(realtimeUrl("{{base}}/ws", "websocket")).toBe("{{base}}/ws");
    expect(realtimeUrl("ftp://x", "websocket")).toBe("ftp://x");
  });
});

describe("websocket", () => {
  it("connects with variables, headers and a subprotocol, then echoes text and binary", async () => {
    const request: RealtimeRequest = {
      ...emptyRealtime("websocket", "{{base}}/ws"),
      headers: [{ key: "X-Clave", value: "{{clave}}", enabled: true }],
      subprotocols: ["tienda.v2", "tienda.v1"],
    };
    const ctx = context({ environment: [{ key: "base", value: server.wsUrl, enabled: true }, { key: "clave", value: "secreta-1", enabled: true, secret: true }] });
    const { connId, result } = await connect(request, ctx);
    expect(result).toMatchObject({ kind: "open", handshake: { status: 101, protocol: "tienda.v2" } });

    const [hello] = await waitFor(connId, isIn);
    // The server reports the secret header back; it is masked in the log.
    expect(JSON.parse(hello!.message.text!)).toMatchObject({ hola: true, protocolo: "tienda.v2", clave: "••••••••", agente: expect.stringMatching(/^Sendix\//) });

    expect(await send(connId, "pedido {{clave}}")).toEqual({ sent: true, error: null });
    const echoes = await waitFor(connId, isIn, 2);
    expect(echoes[1]!.message.text).toBe("eco: pedido ••••••••");
    expect(of(connId).find((e) => e.type === "message" && e.message.dir === "out")).toMatchObject({ message: { text: "pedido ••••••••", size: 16 } });

    await send(connId, "binario");
    const all = await waitFor(connId, isIn, 3);
    expect(all[2]!.message).toMatchObject({ text: null, binary: Buffer.from([0, 1, 2, 250]).toString("base64"), size: 4 });

    await close(connId);
    const [closed] = await waitFor(connId, isClosed);
    expect(closed).toMatchObject({ code: 1000, byUser: true });
  });

  it("reports a rejected handshake with its status", async () => {
    const { result } = await connect(emptyRealtime("websocket", `${server.wsUrl}/ws/privado`));
    expect(result).toMatchObject({ kind: "error", code: "HANDSHAKE_REJECTED", status: 401 });
    const ok = await connect({ ...emptyRealtime("websocket", `${server.wsUrl}/ws/privado`), headers: [{ key: "X-Clave", value: "abrete", enabled: true }] });
    expect(ok.result.kind).toBe("open");
    await close(ok.connId);
  });

  it("reports a refused connection", async () => {
    const { result } = await connect(emptyRealtime("websocket", "ws://127.0.0.1:9/ws"));
    expect(result).toMatchObject({ kind: "error", code: "ECONNREFUSED" });
  });

  it("closes with the server's code and reason", async () => {
    const { connId } = await connect(emptyRealtime("websocket", `${server.wsUrl}/ws`));
    await send(connId, "cerrar");
    const [closed] = await waitFor(connId, isClosed);
    expect(closed).toMatchObject({ code: 4000, reason: "adiós", byUser: false });
    expect(await send(connId, "otra")).toEqual({ sent: false, error: "La conexión no está abierta" });
  });

  it("reconnects after the connection drops when asked to", async () => {
    const request = { ...emptyRealtime("websocket", `${server.wsUrl}/ws`), settings: { ...emptyRealtime("websocket").settings, reconnect: true, maxRetries: 2 } };
    const { connId } = await connect(request);
    await send(connId, "cortar");
    const [reopened] = await waitFor(connId, isOpen);
    expect(reopened!.reconnected).toBe(true);
    expect(of(connId).some((e) => e.type === "info" && /Reconectando, intento 1 de 2/.test(e.text))).toBe(true);
    await close(connId);
    await waitFor(connId, isClosed);
  });

  it("without reconnection, a dropped connection ends as abnormal", async () => {
    const { connId } = await connect(emptyRealtime("websocket", `${server.wsUrl}/ws`));
    await send(connId, "cortar");
    const [closed] = await waitFor(connId, isClosed);
    expect(closed).toMatchObject({ code: 1006, byUser: false });
  });
});

describe("socket.io", () => {
  it("connects with auth and headers, receives every event and gets acks", async () => {
    const request: RealtimeRequest = {
      ...emptyRealtime("socketio", server.url),
      headers: [{ key: "X-Tienda", value: "cdmx", enabled: true }],
      settings: { ...emptyRealtime("socketio").settings, auth: '{ "token": "{{token}}" }' },
    };
    const { connId, result } = await connect(request, context({ environment: [{ key: "token", value: "tok-1", enabled: true }] }));
    expect(result).toMatchObject({ kind: "open", handshake: { socketId: expect.any(String) } });

    const [welcome] = await waitFor(connId, isIn);
    expect(welcome!.message.event).toBe("bienvenida");
    expect(JSON.parse(welcome!.message.text!)).toMatchObject({ auth: { token: "tok-1" }, cabecera: "cdmx" });

    expect(await send(connId, '{ "a": 1 }', { event: "eco", language: "json" })).toEqual({ sent: true, error: null });
    const [, echo] = await waitFor(connId, isIn, 2);
    expect(echo!.message).toMatchObject({ event: "eco", text: '{"a":1}' });

    await send(connId, "[1, 2, 3]", { event: "sumar", language: "json", ack: true });
    const [, , ack] = await waitFor(connId, isIn, 3);
    expect(ack!.message).toMatchObject({ event: "sumar", text: "6", ack: true });

    expect(await send(connId, "{ roto", { event: "eco", language: "json" })).toEqual({ sent: false, error: "El mensaje no es JSON válido" });
    expect(await send(connId, "x", { event: " " })).toEqual({ sent: false, error: "Escribe el nombre del evento" });

    await close(connId);
    const [closed] = await waitFor(connId, isClosed);
    expect(closed!.byUser).toBe(true);
  });

  it("ends when the server disconnects the socket", async () => {
    const { connId } = await connect(emptyRealtime("socketio", server.url));
    await send(connId, "", { event: "echar" });
    const [closed] = await waitFor(connId, isClosed);
    expect(closed).toMatchObject({ byUser: false, reason: "Desconectado: io server disconnect" });
  });

  it("rejects an auth payload that is not a JSON object", async () => {
    const { result } = await connect({ ...emptyRealtime("socketio", server.url), settings: { ...emptyRealtime("socketio").settings, auth: "[1]" } });
    expect(result).toMatchObject({ kind: "error", code: "INVALID_AUTH" });
  });
});

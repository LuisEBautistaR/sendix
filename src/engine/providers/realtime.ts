/**
 * WebSocket (ws) and Socket.IO (socket.io-client) connections. A connection
 * outlives the call that opened it: messages, reconnections and the close are
 * streamed to main as `realtime` events. Every string that leaves the engine has
 * the active secrets masked.
 */
import WebSocket from "ws";
import { io, type Socket } from "socket.io-client";
import sdk from "postman-collection";
import type { ProviderManifest } from "../provider-manager";
import type { MethodParams, MethodResult } from "@shared/methods";
import type { SendContext } from "@shared/http";
import {
  MAX_BINARY_SHOWN,
  MAX_TEXT_SHOWN,
  realtimeUrl,
  type ConnectResult,
  type HandshakeInfo,
  type RealtimeEvent,
  type RealtimeMessage,
  type RealtimeRequest,
} from "@shared/realtime";

const USER_AGENT = `Sendix/${process.env["SENDIX_VERSION"] ?? "dev"}`;
const MAX_PAYLOAD = 100 * 1024 * 1024;
const MASK = "••••••••";

interface Conn {
  id: string;
  request: RealtimeRequest;
  context: SendContext | null;
  ws: WebSocket | null;
  socket: Socket | null;
  byUser: boolean;
  everOpen: boolean;
  retries: number;
  timer: NodeJS.Timeout | null;
  done: boolean;
}

/** {{variables}} from the environment first, then the collection; dynamic ones ({{$guid}}…) too. */
export function resolveVariables(text: string, context: SendContext | null): string {
  if (!text.includes("{{")) return text;
  const scope = (list: SendContext["environment"]) => Object.fromEntries(list.filter((v) => v.enabled).map((v) => [v.key, v.value]));
  return sdk.Property.replaceSubstitutions(text, [scope(context?.environment ?? []), scope(context?.collectionVariables ?? [])]) as string;
}

export function maskSecrets(text: string, context: SendContext | null): string {
  let out = text;
  const secrets = (context?.environment ?? [])
    .filter((v) => v.secret && v.value.length >= 4)
    .map((v) => v.value)
    .sort((a, b) => b.length - a.length);
  for (const s of secrets) out = out.split(s).join(MASK);
  return out;
}

export function toMessage(dir: "in" | "out", data: string | Buffer, context: SendContext | null, extra: { event?: string | null; ack?: boolean } = {}): RealtimeMessage {
  const base = { dir, at: Date.now(), event: extra.event ?? null, ack: extra.ack ?? false };
  if (typeof data === "string") {
    const size = Buffer.byteLength(data);
    const truncated = data.length > MAX_TEXT_SHOWN;
    return { ...base, text: maskSecrets(truncated ? data.slice(0, MAX_TEXT_SHOWN) : data, context), binary: null, size, truncated };
  }
  const truncated = data.byteLength > MAX_BINARY_SHOWN;
  return { ...base, text: null, binary: data.subarray(0, MAX_BINARY_SHOWN).toString("base64"), size: data.byteLength, truncated };
}

const headerList = (headers: Record<string, string | string[] | undefined>) =>
  Object.entries(headers).flatMap(([key, v]) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((value) => ({ key, value }))));

/** Socket.IO arguments as one loggable payload: a lone string stays text, binary stays binary, the rest is JSON. */
function socketPayload(args: unknown[]): string | Buffer {
  if (args.length === 1) {
    const [only] = args;
    if (typeof only === "string") return only;
    if (Buffer.isBuffer(only)) return only;
    if (only instanceof ArrayBuffer) return Buffer.from(only);
  }
  try {
    return JSON.stringify(args.length === 1 ? args[0] : args) ?? "";
  } catch {
    return String(args);
  }
}

export const realtimeProvider: ProviderManifest = {
  name: "realtime",
  methods: ["connect", "send", "close"],
  load: (_deps, ctx) => {
    const conns = new Map<string, Conn>();
    const emit = (event: RealtimeEvent) => ctx.emit("realtime", event.type, event);
    const info = (conn: Conn, text: string) => emit({ type: "info", connId: conn.id, at: Date.now(), text });

    const finish = (conn: Conn, code: number | null, reason: string) => {
      if (conn.done) return;
      conn.done = true;
      if (conn.timer) clearTimeout(conn.timer);
      conns.delete(conn.id);
      emit({ type: "closed", connId: conn.id, at: Date.now(), code, reason: maskSecrets(reason, conn.context), byUser: conn.byUser });
    };

    const headersOf = (conn: Conn) =>
      Object.fromEntries([
        ["User-Agent", USER_AGENT],
        ...conn.request.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key.trim(), resolveVariables(h.value, conn.context)]),
      ]);

    // ---------- WebSocket ----------

    const openWs = (conn: Conn): Promise<ConnectResult> =>
      new Promise((resolve) => {
        const { request } = conn;
        const url = realtimeUrl(resolveVariables(request.url, conn.context), "websocket");
        let handshakeHeaders: HandshakeInfo["headers"] = [];
        let opened = false;
        let ws: WebSocket;
        try {
          ws = new WebSocket(url, request.subprotocols.map((p) => resolveVariables(p, conn.context)), {
            headers: headersOf(conn),
            handshakeTimeout: request.settings.timeoutMs,
            rejectUnauthorized: request.settings.verifyTls,
            followRedirects: true,
            maxPayload: MAX_PAYLOAD,
          });
        } catch (err) {
          resolve({ kind: "error", code: "INVALID_URL", message: maskSecrets((err as Error).message, conn.context), status: null });
          return;
        }
        conn.ws = ws;
        ws.on("upgrade", (res) => (handshakeHeaders = headerList(res.headers)));
        ws.on("open", () => {
          opened = true;
          const handshake: HandshakeInfo = { status: 101, headers: handshakeHeaders, protocol: ws.protocol, extensions: ws.extensions, socketId: null, transport: null, url: maskSecrets(url, conn.context) };
          if (conn.everOpen) {
            conn.retries = 0;
            emit({ type: "open", connId: conn.id, at: Date.now(), handshake, reconnected: true });
          }
          conn.everOpen = true;
          resolve({ kind: "open", handshake });
        });
        ws.on("message", (data: Buffer, isBinary: boolean) => {
          emit({ type: "message", connId: conn.id, message: toMessage("in", isBinary ? data : data.toString("utf8"), conn.context) });
        });
        ws.on("error", (err: Error & { code?: string }) => {
          if (!opened) {
            const status = /Unexpected server response: (\d{3})/.exec(err.message);
            resolve({ kind: "error", code: status ? "HANDSHAKE_REJECTED" : (err.code ?? "CONNECT_FAILED"), message: maskSecrets(err.message, conn.context), status: status ? Number(status[1]) : null });
          } else emit({ type: "error", connId: conn.id, at: Date.now(), message: maskSecrets(err.message, conn.context) });
        });
        ws.on("close", (code: number, reason: Buffer) => {
          if (!opened) {
            // A failed reconnection attempt: try again or give up.
            if (conn.everOpen && !conn.byUser) scheduleReconnect(conn, code, reason.toString("utf8"));
            return;
          }
          const text = reason.toString("utf8");
          const abnormal = code !== 1000 && code !== 1001;
          if (!conn.byUser && abnormal && conn.request.settings.reconnect) scheduleReconnect(conn, code, text);
          else finish(conn, code, text);
        });
      });

    const scheduleReconnect = (conn: Conn, code: number, reason: string) => {
      if (conn.retries >= conn.request.settings.maxRetries) {
        finish(conn, code, reason || "No se pudo reconectar");
        return;
      }
      conn.retries++;
      const delay = Math.min(10_000, 1_000 * 2 ** (conn.retries - 1));
      info(conn, `Conexión perdida (${code}). Reconectando, intento ${conn.retries} de ${conn.request.settings.maxRetries}…`);
      conn.timer = setTimeout(() => {
        conn.timer = null;
        if (conn.byUser || conn.done) return;
        void openWs(conn);
      }, delay);
    };

    // ---------- Socket.IO ----------

    const openSocket = (conn: Conn): Promise<ConnectResult> =>
      new Promise((resolve) => {
        const { request } = conn;
        const url = realtimeUrl(resolveVariables(request.url, conn.context), "socketio");
        let auth: Record<string, unknown> | undefined;
        if (request.settings.auth.trim()) {
          try {
            const parsed: unknown = JSON.parse(resolveVariables(request.settings.auth, conn.context));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
            auth = parsed as Record<string, unknown>;
          } catch {
            resolve({ kind: "error", code: "INVALID_AUTH", message: "El campo auth debe ser un objeto JSON", status: null });
            return;
          }
        }
        let socket: Socket;
        try {
          socket = io(url, {
            path: resolveVariables(request.settings.path, conn.context) || "/socket.io",
            extraHeaders: headersOf(conn),
            ...(auth ? { auth } : {}),
            reconnection: request.settings.reconnect,
            reconnectionAttempts: request.settings.maxRetries,
            timeout: request.settings.timeoutMs,
            rejectUnauthorized: request.settings.verifyTls,
            forceNew: true,
          });
        } catch (err) {
          resolve({ kind: "error", code: "INVALID_URL", message: maskSecrets((err as Error).message, conn.context), status: null });
          return;
        }
        conn.socket = socket;
        const handshake = (): HandshakeInfo => ({
          status: null,
          headers: [],
          protocol: "",
          extensions: "",
          socketId: socket.id ?? null,
          transport: socket.io.engine?.transport?.name ?? null,
          url: maskSecrets(url, conn.context),
        });

        socket.on("connect", () => {
          if (conn.everOpen) emit({ type: "open", connId: conn.id, at: Date.now(), handshake: handshake(), reconnected: true });
          else {
            conn.everOpen = true;
            resolve({ kind: "open", handshake: handshake() });
          }
        });
        socket.on("connect_error", (err: Error) => {
          if (!conn.everOpen) {
            socket.close();
            resolve({ kind: "error", code: "CONNECT_FAILED", message: maskSecrets(err.message, conn.context), status: null });
          } else emit({ type: "error", connId: conn.id, at: Date.now(), message: maskSecrets(err.message, conn.context) });
        });
        socket.onAny((event: string, ...args: unknown[]) => {
          emit({ type: "message", connId: conn.id, message: toMessage("in", socketPayload(args), conn.context, { event }) });
        });
        socket.on("disconnect", (reason: string) => {
          if (conn.byUser || reason === "io client disconnect") return finish(conn, null, "Cerrada por el usuario");
          if (reason === "io server disconnect" || !request.settings.reconnect) return finish(conn, null, `Desconectado: ${reason}`);
          info(conn, `Desconectado (${reason}). Reconectando…`);
        });
        socket.io.on("reconnect_attempt", (n: number) => info(conn, `Intento de reconexión ${n} de ${request.settings.maxRetries}…`));
        socket.io.on("reconnect_failed", () => {
          socket.close();
          finish(conn, null, "No se pudo reconectar");
        });
      });

    // ---------- methods ----------

    const connect = async (params: unknown): Promise<MethodResult<"realtime.connect">> => {
      const { connId, request, context = null } = params as MethodParams<"realtime.connect">;
      if (conns.has(connId)) return { kind: "error", code: "ALREADY_OPEN", message: "Esta conexión ya está abierta", status: null };
      const conn: Conn = { id: connId, request, context, ws: null, socket: null, byUser: false, everOpen: false, retries: 0, timer: null, done: false };
      conns.set(connId, conn);
      const result = await (request.protocol === "websocket" ? openWs(conn) : openSocket(conn));
      if (result.kind === "error") {
        conn.done = true;
        conns.delete(connId);
      } else if (conn.byUser) {
        // Closed while the handshake was in flight.
        finish(conn, 1000, "Cerrada por el usuario");
      }
      return result;
    };

    const send = (params: unknown): MethodResult<"realtime.send"> => {
      const { connId, message, context = null } = params as MethodParams<"realtime.send">;
      const conn = conns.get(connId);
      if (!conn) return { sent: false, error: "La conexión no está abierta" };
      if (context) conn.context = context;
      const body = resolveVariables(message.body, conn.context);

      if (conn.request.protocol === "websocket") {
        if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return { sent: false, error: "La conexión no está abierta" };
        conn.ws.send(body);
        emit({ type: "message", connId, message: toMessage("out", body, conn.context) });
        return { sent: true, error: null };
      }

      const socket = conn.socket;
      if (!socket?.connected) return { sent: false, error: "La conexión no está abierta" };
      const event = resolveVariables(message.event, conn.context).trim();
      if (!event) return { sent: false, error: "Escribe el nombre del evento" };
      let args: unknown[] = [];
      if (body.trim() !== "") {
        if (message.language === "json") {
          try {
            args = [JSON.parse(body)];
          } catch {
            return { sent: false, error: "El mensaje no es JSON válido" };
          }
        } else args = [body];
      }
      if (message.ack) {
        socket.timeout(conn.request.settings.timeoutMs).emit(event, ...args, (err: Error | null, ...reply: unknown[]) => {
          if (err) info(conn, `«${event}» no recibió respuesta (ack) a tiempo`);
          else emit({ type: "message", connId, message: toMessage("in", socketPayload(reply), conn.context, { event, ack: true }) });
        });
      } else socket.emit(event, ...args);
      emit({ type: "message", connId, message: toMessage("out", body, conn.context, { event, ack: message.ack }) });
      return { sent: true, error: null };
    };

    const close = (params: unknown): MethodResult<"realtime.close"> => {
      const { connId } = params as MethodParams<"realtime.close">;
      const conn = conns.get(connId);
      if (!conn) return { closed: false };
      conn.byUser = true;
      if (conn.timer) {
        // Waiting to reconnect: nothing is open, so the connection ends here.
        finish(conn, null, "Cerrada por el usuario");
      } else if (conn.ws) {
        if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close(1000, "");
        else conn.ws.terminate();
      } else conn.socket?.disconnect();
      return { closed: true };
    };

    return { connect, send, close };
  },
};

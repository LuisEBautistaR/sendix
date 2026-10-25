/**
 * WebSocket and Socket.IO connections: what the UI edits and saves, the calls to
 * the engine and the events the engine streams back while a connection is open.
 */
import { z } from "zod";
import { keyValueSchema } from "./http";

export const REALTIME_PROTOCOLS = ["websocket", "socketio"] as const;
export type RealtimeProtocol = (typeof REALTIME_PROTOCOLS)[number];

export const MESSAGE_LANGUAGES = ["json", "text"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

export const connIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const savedMessageSchema = z.object({
  name: z.string().max(200),
  body: z.string().max(1_048_576),
  language: z.enum(MESSAGE_LANGUAGES),
  /** Socket.IO only: the event to emit. */
  event: z.string().max(256),
});
export type SavedMessage = z.infer<typeof savedMessageSchema>;

export const realtimeSettingsSchema = z.object({
  /** Reconnect after the connection drops unexpectedly (never after a failed first connect). */
  reconnect: z.boolean(),
  maxRetries: z.number().int().min(1).max(20),
  /** Time allowed for the opening handshake. */
  timeoutMs: z.number().int().min(1_000).max(120_000),
  verifyTls: z.boolean(),
  /** Socket.IO only: server path and the handshake `auth` payload (JSON, may use variables). */
  path: z.string().max(512),
  auth: z.string().max(65_536),
});
export type RealtimeSettings = z.infer<typeof realtimeSettingsSchema>;

export const DEFAULT_REALTIME_SETTINGS: RealtimeSettings = { reconnect: false, maxRetries: 3, timeoutMs: 20_000, verifyTls: true, path: "/socket.io", auth: "" };

export const realtimeRequestSchema = z.object({
  protocol: z.enum(REALTIME_PROTOCOLS),
  url: z.string().max(16_384),
  headers: z.array(keyValueSchema).max(500),
  /** WebSocket only: subprotocols to offer, in order of preference. */
  subprotocols: z.array(z.string().min(1).max(256)).max(20),
  settings: realtimeSettingsSchema,
  messages: z.array(savedMessageSchema).max(200),
});
export type RealtimeRequest = z.infer<typeof realtimeRequestSchema>;

export function emptyRealtime(protocol: RealtimeProtocol, url = ""): RealtimeRequest {
  return { protocol, url, headers: [], subprotocols: [], settings: { ...DEFAULT_REALTIME_SETTINGS }, messages: [] };
}

/** A message typed in the composer. `ack` asks a Socket.IO server to answer this emit. */
export const outgoingMessageSchema = z.object({
  body: z.string().max(10_485_760),
  language: z.enum(MESSAGE_LANGUAGES),
  event: z.string().max(256),
  ack: z.boolean(),
});
export type OutgoingMessage = z.infer<typeof outgoingMessageSchema>;

export const handshakeInfoSchema = z.object({
  /** 101 for WebSocket; null for Socket.IO, whose transport may start with HTTP polling. */
  status: z.number().int().nullable(),
  headers: z.array(z.object({ key: z.string(), value: z.string() })),
  protocol: z.string(),
  extensions: z.string(),
  /** Socket.IO: socket id and transport in use. */
  socketId: z.string().nullable(),
  transport: z.string().nullable(),
  url: z.string(),
});
export type HandshakeInfo = z.infer<typeof handshakeInfoSchema>;

export const connectResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), handshake: handshakeInfoSchema }),
  z.object({ kind: z.literal("error"), code: z.string(), message: z.string(), status: z.number().int().nullable() }),
]);
export type ConnectResult = z.infer<typeof connectResultSchema>;

/** One logged message. Text over 1 MB and binary over 64 KB are cut for display; `size` is the real size. */
export const realtimeMessageSchema = z.object({
  dir: z.enum(["in", "out"]),
  at: z.number(),
  event: z.string().nullable(),
  text: z.string().nullable(),
  /** Base64 of the first bytes of a binary message. */
  binary: z.string().nullable(),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** Socket.IO: this message answers an emit (or asked for an answer). */
  ack: z.boolean(),
});
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;

export const realtimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), connId: connIdSchema, message: realtimeMessageSchema }),
  /** Reconnection attempts and other notes for the log. */
  z.object({ type: z.literal("info"), connId: connIdSchema, at: z.number(), text: z.string() }),
  z.object({ type: z.literal("open"), connId: connIdSchema, at: z.number(), handshake: handshakeInfoSchema, reconnected: z.boolean() }),
  z.object({ type: z.literal("error"), connId: connIdSchema, at: z.number(), message: z.string() }),
  /** Final: no more events for this connection id. */
  z.object({ type: z.literal("closed"), connId: connIdSchema, at: z.number(), code: z.number().int().nullable(), reason: z.string(), byUser: z.boolean() }),
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

export const MAX_TEXT_SHOWN = 1_048_576;
export const MAX_BINARY_SHOWN = 65_536;

/** Explains WebSocket close codes in a few words. */
export function closeCodeLabel(code: number | null): string {
  if (code === null) return "Sin código";
  const known: Record<number, string> = {
    1000: "Normal",
    1001: "Se fue",
    1002: "Error de protocolo",
    1003: "Datos no admitidos",
    1005: "Sin código",
    1006: "Anormal",
    1007: "Datos no válidos",
    1008: "Política",
    1009: "Demasiado grande",
    1011: "Error del servidor",
    1012: "Reinicio del servidor",
    1015: "Fallo TLS",
  };
  return known[code] ?? (code >= 4000 ? "De la aplicación" : "Otro");
}

/** Adds or fixes the scheme: ws(s):// for WebSocket, http(s):// for Socket.IO. Variables at the start are left alone. */
export function realtimeUrl(raw: string, protocol: RealtimeProtocol): string {
  const url = raw.trim();
  if (url === "" || url.startsWith("{{")) return url;
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  const secure = m ? /^(https|wss)$/i.test(m[1]!) : false;
  const rest = m ? url.slice(m[0].length) : url;
  if (m && !/^(https?|wss?)$/i.test(m[1]!)) return url;
  return `${protocol === "websocket" ? (secure ? "wss" : "ws") : secure ? "https" : "http"}://${rest}`;
}

/**
 * Wire format between main and the engine (utilityProcess), carried over a MessagePort.
 *
 *   call    → { kind: "call",   id, method, params }
 *   result  ← { kind: "result", id, ok: true, value } | { kind: "result", id, ok: false, error }
 *   event   ← { kind: "event",  stream, name, data }        (status, streaming responses)
 *   cancel  → { kind: "cancel", id }
 *
 * Both ends validate every envelope; method params and results are validated
 * against the contracts in ./methods.ts.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type RpcError = z.infer<typeof errorSchema>;

export const callSchema = z.object({
  kind: z.literal("call"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});

export const resultSchema = z.discriminatedUnion("ok", [
  z.object({ kind: z.literal("result"), id: z.string().min(1), ok: z.literal(true), value: z.unknown() }),
  z.object({ kind: z.literal("result"), id: z.string().min(1), ok: z.literal(false), error: errorSchema }),
]);

export const eventSchema = z.object({
  kind: z.literal("event"),
  stream: z.string().min(1),
  name: z.string().min(1),
  data: z.unknown(),
});

export const cancelSchema = z.object({
  kind: z.literal("cancel"),
  id: z.string().min(1),
});

export const toEngineSchema = z.discriminatedUnion("kind", [callSchema, cancelSchema]);
export const fromEngineSchema = z.union([resultSchema, eventSchema]);

export type CallEnvelope = z.infer<typeof callSchema>;
export type ResultEnvelope = z.infer<typeof resultSchema>;
export type EventEnvelope = z.infer<typeof eventSchema>;
export type ToEngine = z.infer<typeof toEngineSchema>;
export type FromEngine = z.infer<typeof fromEngineSchema>;

/** First message main sends to the engine, together with the MessagePort. */
export const handshakeSchema = z.object({
  type: z.literal("connect"),
  protocol: z.literal(PROTOCOL_VERSION),
  testMode: z.boolean(),
});
export type Handshake = z.infer<typeof handshakeSchema>;

/** Result as returned to callers (main and renderer never see thrown errors from the engine). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: RpcError };

export const ErrorCodes = {
  invalidEnvelope: "INVALID_ENVELOPE",
  unknownMethod: "UNKNOWN_METHOD",
  invalidParams: "INVALID_PARAMS",
  invalidResult: "INVALID_RESULT",
  providerFailed: "PROVIDER_FAILED",
  cancelled: "CANCELLED",
  timeout: "TIMEOUT",
  engineUnavailable: "ENGINE_UNAVAILABLE",
  engineExited: "ENGINE_EXITED",
  forbidden: "FORBIDDEN",
} as const;

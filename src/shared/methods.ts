/**
 * Every engine method the app may call, with its params and result contracts.
 * The renderer can only reach methods listed here (the main process enforces it),
 * and both main and the engine validate params and results against these schemas.
 */
import { z } from "zod";
import { httpOutcomeSchema, httpRequestSchema, networkOptionsSchema, requestIdSchema, requestSourceSchema, sendContextSchema } from "./http";
import { dataRowSchema } from "./runner";
import { connIdSchema, connectResultSchema, outgoingMessageSchema, realtimeRequestSchema } from "./realtime";
import { callIdSchema, describeResultSchema, grpcRequestSchema, startResultSchema } from "./grpc";

export const methods = {
  /** Sends one HTTP request. `requestId` is chosen by the caller so it can cancel. */
  "http.send": {
    params: z.object({
      requestId: requestIdSchema,
      request: httpRequestSchema,
      /** Saved request this tab edits, if any: main uses it to work out inherited auth and variables. */
      source: requestSourceSchema.nullable().optional(),
      /** Filled in by main only; whatever the renderer sends here is discarded. */
      context: sendContextSchema.nullable().optional(),
      /** Collection runner only: the data file row for this iteration (pm.iterationData, {{column}}). */
      iterationData: dataRowSchema.nullable().optional(),
      /** Filled in by main from the preferences; the engine falls back to MAX_RESPONSE_BYTES. */
      maxResponseBytes: z.number().int().min(1).max(500 * 1024 * 1024).optional(),
      /** Runner only: a run's own cookie jar; omitted uses the engine's shared jar. */
      cookieJar: z.string().min(1).max(64).nullable().optional(),
      /** Filled in by main only: proxy and certificates from Settings. */
      network: networkOptionsSchema.optional(),
    }),
    result: httpOutcomeSchema,
    testOnly: false,
  },
  "http.cancel": {
    params: z.object({ requestId: requestIdSchema }),
    result: z.object({ cancelled: z.boolean() }),
    testOnly: false,
  },
  /** Forgets a run's cookie jar, first copying its cookies into the shared one when `keep` is set. */
  "http.dropJar": {
    params: z.object({ jar: z.string().min(1).max(64), keep: z.boolean() }),
    result: z.object({ copied: z.number().int().min(0) }),
    testOnly: false,
  },
  /**
   * Opens a WebSocket or Socket.IO connection. Resolves once it is open or has failed;
   * afterwards the engine streams `realtime` events (messages, reconnections, close).
   */
  "realtime.connect": {
    params: z.object({
      connId: connIdSchema,
      request: realtimeRequestSchema,
      source: requestSourceSchema.nullable().optional(),
      /** Filled in by main only. */
      context: sendContextSchema.nullable().optional(),
    }),
    result: connectResultSchema,
    testOnly: false,
  },
  "realtime.send": {
    params: z.object({
      connId: connIdSchema,
      message: outgoingMessageSchema,
      source: requestSourceSchema.nullable().optional(),
      /** Filled in by main only. */
      context: sendContextSchema.nullable().optional(),
    }),
    result: z.object({ sent: z.boolean(), error: z.string().nullable() }),
    testOnly: false,
  },
  "realtime.close": {
    params: z.object({ connId: connIdSchema }),
    result: z.object({ closed: z.boolean() }),
    testOnly: false,
  },
  /** Lists the services and methods of a gRPC server (reflection) or of .proto files. */
  "grpc.describe": {
    params: z.object({ request: grpcRequestSchema, source: requestSourceSchema.nullable().optional(), context: sendContextSchema.nullable().optional() }),
    result: describeResultSchema,
    testOnly: false,
  },
  /** Starts a gRPC call; headers, messages and the final status stream as `grpc` events. */
  "grpc.start": {
    params: z.object({ callId: callIdSchema, request: grpcRequestSchema, source: requestSourceSchema.nullable().optional(), context: sendContextSchema.nullable().optional() }),
    result: startResultSchema,
    testOnly: false,
  },
  /** Client and bidirectional streams: one more request message. */
  "grpc.send": {
    params: z.object({ callId: callIdSchema, message: z.string().max(10_485_760), source: requestSourceSchema.nullable().optional(), context: sendContextSchema.nullable().optional() }),
    result: z.object({ sent: z.boolean(), error: z.string().nullable() }),
    testOnly: false,
  },
  /** Client and bidirectional streams: no more request messages. */
  "grpc.end": {
    params: z.object({ callId: callIdSchema }),
    result: z.object({ ended: z.boolean() }),
    testOnly: false,
  },
  "grpc.cancel": {
    params: z.object({ callId: callIdSchema }),
    result: z.object({ cancelled: z.boolean() }),
    testOnly: false,
  },
  /** Converts an OpenAPI 3 / Swagger 2 definition (JSON or YAML) into a v2.1 collection. Parsing untrusted files stays out of main. */
  "import.openapi": {
    params: z.object({ text: z.string().min(1).max(20 * 1024 * 1024) }),
    result: z.object({ collection: z.record(z.string(), z.unknown()), warnings: z.array(z.string()) }),
    testOnly: false,
  },
  "system.ping": {
    params: z.object({ sentAt: z.number() }),
    result: z.object({
      sentAt: z.number(),
      engineTime: z.number(),
      pid: z.number().int(),
      uptimeMs: z.number(),
    }),
    testOnly: false,
  },
  "system.info": {
    params: z.object({}),
    result: z.object({
      node: z.string(),
      v8: z.string(),
      platform: z.string(),
      arch: z.string(),
      providers: z.array(z.string()),
    }),
    testOnly: false,
  },
  /** Kills the engine on purpose so tests can check that main restarts it. */
  "diagnostics.crash": {
    params: z.object({ exitCode: z.number().int().min(1).max(255) }),
    result: z.object({ scheduled: z.literal(true) }),
    testOnly: true,
  },
} as const;

export type MethodName = keyof typeof methods;
export type MethodParams<M extends MethodName> = z.input<(typeof methods)[M]["params"]>;
export type MethodResult<M extends MethodName> = z.output<(typeof methods)[M]["result"]>;

export function isMethodName(value: unknown): value is MethodName {
  return typeof value === "string" && Object.hasOwn(methods, value);
}

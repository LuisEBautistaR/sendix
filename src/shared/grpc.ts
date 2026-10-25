/**
 * gRPC calls: the request the UI edits and saves, the engine calls and the
 * events a running call streams back. Messages travel as JSON text using the
 * field names of the .proto file.
 */
import { z } from "zod";
import { keyValueSchema } from "./http";

export const callIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const path = z.string().max(4_096);

export const grpcDefinitionSchema = z.object({
  /** Ask the server (gRPC server reflection) or read .proto files. */
  source: z.enum(["reflection", "files"]),
  files: z.array(path).max(50),
  /** Folders where imports are looked up, besides each file's own folder. */
  importPaths: z.array(path).max(20),
});
export type GrpcDefinition = z.infer<typeof grpcDefinitionSchema>;

export const GRPC_TLS = ["none", "tls", "insecure"] as const;
export type GrpcTls = (typeof GRPC_TLS)[number];

export const grpcSettingsSchema = z.object({
  /** none: plaintext; tls: verified TLS; insecure: TLS without verifying the server certificate. */
  tls: z.enum(GRPC_TLS),
  /** PEM files for a private CA and for mutual TLS (client certificate and key). */
  caFile: path,
  certFile: path,
  keyFile: path,
  /** 0 = no deadline. */
  deadlineMs: z.number().int().min(0).max(3_600_000),
});
export type GrpcSettings = z.infer<typeof grpcSettingsSchema>;

export const DEFAULT_GRPC_SETTINGS: GrpcSettings = { tls: "none", caFile: "", certFile: "", keyFile: "", deadlineMs: 30_000 };

export const grpcRequestSchema = z.object({
  /** host:port; grpcs:// or https:// forces TLS. */
  target: z.string().max(2_048),
  definition: grpcDefinitionSchema,
  /** Fully qualified service name (tienda.v1.Tienda) and method name. */
  service: z.string().max(512),
  method: z.string().max(256),
  message: z.string().max(10_485_760),
  metadata: z.array(keyValueSchema).max(200),
  settings: grpcSettingsSchema,
});
export type GrpcRequest = z.infer<typeof grpcRequestSchema>;

export function emptyGrpc(target = ""): GrpcRequest {
  return { target, definition: { source: "reflection", files: [], importPaths: [] }, service: "", method: "", message: "{}", metadata: [], settings: { ...DEFAULT_GRPC_SETTINGS } };
}

export const CALL_TYPES = ["unary", "server", "client", "bidi"] as const;
export type CallType = (typeof CALL_TYPES)[number];
export const CALL_TYPE_LABEL: Record<CallType, string> = {
  unary: "Unaria",
  server: "Stream del servidor",
  client: "Stream del cliente",
  bidi: "Bidireccional",
};

export const grpcMethodInfoSchema = z.object({
  name: z.string(),
  type: z.enum(CALL_TYPES),
  requestType: z.string(),
  responseType: z.string(),
  /** A request message with every field filled with a sample value. */
  example: z.string(),
});
export type GrpcMethodInfo = z.infer<typeof grpcMethodInfoSchema>;

export const grpcServiceInfoSchema = z.object({ name: z.string(), methods: z.array(grpcMethodInfoSchema) });
export type GrpcServiceInfo = z.infer<typeof grpcServiceInfoSchema>;

export const describeResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), services: z.array(grpcServiceInfoSchema), files: z.array(z.string()) }),
  z.object({ kind: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type DescribeResult = z.infer<typeof describeResultSchema>;

export const startResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), type: z.enum(CALL_TYPES) }),
  z.object({ kind: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type StartResult = z.infer<typeof startResultSchema>;

const pairs = z.array(z.object({ key: z.string(), value: z.string() }));

export const grpcEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("headers"), callId: callIdSchema, at: z.number(), headers: pairs }),
  z.object({
    type: z.literal("message"),
    callId: callIdSchema,
    dir: z.enum(["in", "out"]),
    at: z.number(),
    /** JSON text; cut at 1 MB for display. */
    text: z.string(),
    size: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  /** Final: the call ended with this status. */
  z.object({
    type: z.literal("status"),
    callId: callIdSchema,
    at: z.number(),
    code: z.number().int(),
    name: z.string(),
    details: z.string(),
    trailers: pairs,
    elapsedMs: z.number(),
  }),
]);
export type GrpcEvent = z.infer<typeof grpcEventSchema>;

/** Status codes in words, for the UI. */
export const GRPC_STATUS_HINT: Record<string, string> = {
  OK: "Correcto",
  CANCELLED: "Cancelada",
  UNKNOWN: "Error desconocido en el servidor",
  INVALID_ARGUMENT: "Argumento no válido",
  DEADLINE_EXCEEDED: "Se agotó el tiempo máximo (deadline)",
  NOT_FOUND: "No encontrado",
  ALREADY_EXISTS: "Ya existe",
  PERMISSION_DENIED: "Permiso denegado",
  RESOURCE_EXHAUSTED: "Recursos agotados o límite superado",
  FAILED_PRECONDITION: "Precondición no cumplida",
  ABORTED: "Abortada",
  OUT_OF_RANGE: "Fuera de rango",
  UNIMPLEMENTED: "El servidor no implementa este método",
  INTERNAL: "Error interno del servidor",
  UNAVAILABLE: "Servidor no disponible: revisa la dirección, el puerto y el modo TLS",
  DATA_LOSS: "Pérdida de datos",
  UNAUTHENTICATED: "Falta autenticación o no es válida",
};

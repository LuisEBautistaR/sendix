/**
 * Loads gRPC schemas with protobufjs, from .proto files or from the server's
 * reflection service, and converts messages between JSON text and protobuf.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import protobuf from "protobufjs";
import descriptor from "protobufjs/ext/descriptor/index.js";
import * as grpc from "@grpc/grpc-js";
import type { CallType, GrpcMethodInfo, GrpcServiceInfo } from "@shared/grpc";

export class SchemaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------- .proto files ----------

export function loadProtoFiles(files: readonly string[], importPaths: readonly string[]): protobuf.Root {
  if (files.length === 0) throw new SchemaError("NO_PROTO", "Elige al menos un archivo .proto");
  const root = new protobuf.Root();
  root.resolvePath = (origin, target) => {
    if (isAbsolute(target)) return target;
    const candidates = [...(origin ? [resolve(dirname(origin), target)] : []), ...importPaths.map((p) => resolve(p, target))];
    // google/protobuf/*.proto not found on disk falls back to the copies bundled with protobufjs.
    return candidates.find((c) => existsSync(c)) ?? target;
  };
  try {
    root.loadSync([...files], { keepCase: true });
    root.resolveAll();
  } catch (err) {
    throw new SchemaError("PROTO_INVALID", (err as Error).message);
  }
  return root;
}

// ---------- server reflection ----------

const REFLECTION_JSON = {
  nested: {
    ServerReflectionRequest: {
      oneofs: { message_request: { oneof: ["file_by_filename", "file_containing_symbol", "list_services"] } },
      fields: { host: { type: "string", id: 1 }, file_by_filename: { type: "string", id: 3 }, file_containing_symbol: { type: "string", id: 4 }, list_services: { type: "string", id: 7 } },
    },
    ServerReflectionResponse: {
      oneofs: { message_response: { oneof: ["file_descriptor_response", "list_services_response", "error_response"] } },
      fields: {
        valid_host: { type: "string", id: 1 },
        file_descriptor_response: { type: "FileDescriptorResponse", id: 4 },
        list_services_response: { type: "ListServiceResponse", id: 6 },
        error_response: { type: "ErrorResponse", id: 7 },
      },
    },
    FileDescriptorResponse: { fields: { file_descriptor_proto: { rule: "repeated", type: "bytes", id: 1 } } },
    ListServiceResponse: { fields: { service: { rule: "repeated", type: "ServiceResponse", id: 1 } } },
    ServiceResponse: { fields: { name: { type: "string", id: 1 } } },
    ErrorResponse: { fields: { error_code: { type: "int32", id: 1 }, error_message: { type: "string", id: 2 } } },
  },
};
const reflectionRoot = protobuf.Root.fromJSON(REFLECTION_JSON);
const ReflectionRequest = reflectionRoot.lookupType("ServerReflectionRequest");
const ReflectionResponse = reflectionRoot.lookupType("ServerReflectionResponse");

type ReflectionReply = {
  file_descriptor_response?: { file_descriptor_proto: Uint8Array[] };
  list_services_response?: { service: Array<{ name: string }> };
  error_response?: { error_code: number; error_message: string };
};

/** Sends reflection requests over one stream and returns the replies in order. */
function reflect(client: grpc.Client, version: "v1" | "v1alpha", requests: object[], metadata: grpc.Metadata, deadline: number): Promise<ReflectionReply[]> {
  return new Promise((ok, fail) => {
    const replies: ReflectionReply[] = [];
    const call = client.makeBidiStreamRequest(
      `/grpc.reflection.${version}.ServerReflection/ServerReflectionInfo`,
      (value: object) => Buffer.from(ReflectionRequest.encode(ReflectionRequest.fromObject(value)).finish()),
      (bytes: Buffer) => ReflectionResponse.toObject(ReflectionResponse.decode(bytes), { defaults: false, arrays: true }) as ReflectionReply,
      metadata,
      { deadline },
    );
    call.on("data", (reply: ReflectionReply) => {
      replies.push(reply);
      if (replies.length === requests.length) call.end();
    });
    call.on("error", (err: grpc.ServiceError) => fail(err));
    call.on("end", () => ok(replies));
    for (const r of requests) call.write(r);
  });
}

export async function loadByReflection(client: grpc.Client, metadata: grpc.Metadata, timeoutMs: number): Promise<protobuf.Root> {
  const deadline = Date.now() + timeoutMs;
  let version: "v1" | "v1alpha" = "v1";
  let listed: ReflectionReply[];
  try {
    listed = await reflect(client, version, [{ list_services: "" }], metadata, deadline);
  } catch (err) {
    if ((err as grpc.ServiceError).code !== grpc.status.UNIMPLEMENTED) throw err;
    version = "v1alpha";
    try {
      listed = await reflect(client, version, [{ list_services: "" }], metadata, deadline);
    } catch (again) {
      if ((again as grpc.ServiceError).code === grpc.status.UNIMPLEMENTED) {
        throw new SchemaError("NO_REFLECTION", "El servidor no tiene reflexión activada. Carga los archivos .proto en su lugar.");
      }
      throw again;
    }
  }
  const services = (listed[0]?.list_services_response?.service ?? []).map((s) => s.name).filter((n) => !n.startsWith("grpc.reflection."));

  const files = new Map<string, protobuf.Message & { name?: string; dependency?: string[] }>();
  const addFiles = (replies: ReflectionReply[]) => {
    for (const reply of replies) {
      for (const bytes of reply.file_descriptor_response?.file_descriptor_proto ?? []) {
        const file = descriptor.FileDescriptorProto.decode(bytes) as protobuf.Message & { name?: string; dependency?: string[] };
        if (file.name && !files.has(file.name)) files.set(file.name, file);
      }
    }
  };
  addFiles(await reflect(client, version, services.map((s) => ({ file_containing_symbol: s })), metadata, deadline));
  // Ask for any dependency the server did not send along.
  for (let round = 0; round < 5; round++) {
    const missing = [...files.values()].flatMap((f) => f.dependency ?? []).filter((d) => !files.has(d));
    if (!missing.length) break;
    addFiles(await reflect(client, version, [...new Set(missing)].map((name) => ({ file_by_filename: name })), metadata, deadline).catch(() => []));
  }
  try {
    // fromDescriptor is added to Root by protobufjs/ext/descriptor.
    const root = (protobuf.Root as unknown as { fromDescriptor(set: object): protobuf.Root }).fromDescriptor({ file: [...files.values()] });
    root.resolveAll();
    return root;
  } catch (err) {
    throw new SchemaError("REFLECTION_INVALID", `El servidor devolvió un esquema incompleto: ${(err as Error).message}`);
  }
}

// ---------- services, methods and examples ----------

const fullName = (o: protobuf.ReflectionObject) => o.fullName.replace(/^\./, "");

export function callType(m: protobuf.Method): CallType {
  if (m.requestStream && m.responseStream) return "bidi";
  if (m.requestStream) return "client";
  if (m.responseStream) return "server";
  return "unary";
}

function sampleScalar(type: string): unknown {
  switch (type) {
    case "string":
      return "";
    case "bool":
      return false;
    case "bytes":
      return "";
    case "int64":
    case "uint64":
    case "sint64":
    case "fixed64":
    case "sfixed64":
      return "0";
    default:
      return 0;
  }
}

/** A JSON object with every field of `type`, nested messages included (cycles and deep nesting stop at 4 levels). */
export function example(type: protobuf.Type, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const inOneof = new Set<string>();
  for (const oneof of type.oneofsArray) oneof.fieldsArray.slice(1).forEach((f) => inOneof.add(f.name));
  for (const field of type.fieldsArray) {
    if (inOneof.has(field.name)) continue; // Only the first member of each oneof.
    field.resolve();
    let value: unknown;
    if (field.resolvedType instanceof protobuf.Enum) value = Object.keys(field.resolvedType.values)[0] ?? 0;
    else if (field.resolvedType instanceof protobuf.Type) {
      const name = fullName(field.resolvedType);
      if (name === "google.protobuf.Timestamp") value = { seconds: "0", nanos: 0 };
      else value = depth >= 3 ? {} : example(field.resolvedType, depth + 1);
    } else value = sampleScalar(field.type);
    out[field.name] = field instanceof protobuf.MapField ? { clave: value } : field.repeated ? [value] : value;
  }
  return out;
}

export function describe(root: protobuf.Root): GrpcServiceInfo[] {
  const services: GrpcServiceInfo[] = [];
  const walk = (ns: protobuf.NamespaceBase) => {
    for (const nested of ns.nestedArray) {
      if (nested instanceof protobuf.Service) {
        if (fullName(nested).startsWith("grpc.reflection.")) continue;
        services.push({
          name: fullName(nested),
          methods: nested.methodsArray.map((m): GrpcMethodInfo => {
            m.resolve();
            return {
              name: m.name,
              type: callType(m),
              requestType: fullName(m.resolvedRequestType!),
              responseType: fullName(m.resolvedResponseType!),
              example: JSON.stringify(example(m.resolvedRequestType!), null, 2),
            };
          }),
        });
      } else if (nested instanceof protobuf.Namespace) walk(nested);
    }
  };
  walk(root);
  return services.sort((a, b) => a.name.localeCompare(b.name));
}

export function findMethod(root: protobuf.Root, service: string, method: string): protobuf.Method {
  let svc: protobuf.Service;
  try {
    svc = root.lookupService(service);
  } catch {
    throw new SchemaError("NO_SERVICE", `El servicio «${service}» no está en la definición`);
  }
  const m = svc.methods[method];
  if (!m) throw new SchemaError("NO_METHOD", `«${service}» no tiene el método «${method}»`);
  m.resolve();
  return m;
}

/** Field names that are not in the message type, with their path (protobufjs would drop them silently). */
export function unknownFields(type: protobuf.Type, value: unknown, at = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const field = type.fields[key];
    if (!field) {
      out.push(`${at}${key}`);
      continue;
    }
    field.resolve();
    if (field.resolvedType instanceof protobuf.Type && !(field instanceof protobuf.MapField)) {
      const items = field.repeated && Array.isArray(v) ? v : [v];
      for (const item of items) out.push(...unknownFields(field.resolvedType, item, `${at}${key}.`));
    }
  }
  return out;
}

export function encoder(type: protobuf.Type) {
  return (value: unknown): Buffer => Buffer.from(type.encode(type.fromObject(value as Record<string, unknown>)).finish());
}

export function decoder(type: protobuf.Type) {
  return (bytes: Buffer): unknown => type.toObject(type.decode(bytes), { longs: String, enums: String, bytes: String, defaults: true, arrays: true, objects: true, oneofs: true });
}

/** Parses the editor text and checks it against the message type. */
export function parseMessage(type: protobuf.Type, text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = text.trim() === "" ? {} : JSON.parse(text);
  } catch (err) {
    throw new SchemaError("INVALID_JSON", `El mensaje no es JSON válido: ${(err as Error).message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchemaError("INVALID_JSON", `El mensaje debe ser un objeto JSON (${fullName(type)})`);
  const unknown = unknownFields(type, value);
  if (unknown.length) throw new SchemaError("UNKNOWN_FIELD", `Campos que no existen en ${fullName(type)}: ${unknown.join(", ")}`);
  const problem = type.verify(type.fromObject(value as Record<string, unknown>));
  if (problem) throw new SchemaError("INVALID_MESSAGE", problem);
  return value as Record<string, unknown>;
}

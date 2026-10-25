/**
 * gRPC calls with @grpc/grpc-js and protobufjs: describe a server (reflection or
 * .proto files) and run the four call types. A call outlives the `start` request:
 * response headers, messages and the final status stream to main as `grpc` events.
 */
import { readFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import type protobuf from "protobufjs";
import type { ProviderManifest } from "../provider-manager";
import type { MethodParams, MethodResult } from "@shared/methods";
import type { SendContext } from "@shared/http";
import type { CallType, GrpcDefinition, GrpcEvent, GrpcRequest, GrpcSettings } from "@shared/grpc";
import { MAX_TEXT_SHOWN } from "@shared/realtime";
import { maskSecrets, resolveVariables } from "./realtime";
import { SchemaError, callType, decoder, describe, encoder, findMethod, loadByReflection, loadProtoFiles, parseMessage } from "../grpc/schema";

const USER_AGENT = `Sendix/${process.env["SENDIX_VERSION"] ?? "dev"}`;
const MAX_MESSAGE = 50 * 1024 * 1024;
const REFLECTION_TIMEOUT_MS = 15_000;
const STATUS_NAME = Object.fromEntries(Object.entries(grpc.status).filter(([, v]) => typeof v === "number").map(([k, v]) => [v, k])) as Record<number, string>;

interface ActiveCall {
  id: string;
  type: CallType;
  context: SendContext | null;
  call: grpc.ClientWritableStream<unknown> | grpc.ClientDuplexStream<unknown, unknown> | grpc.ClientUnaryCall | grpc.ClientReadableStream<unknown>;
  client: grpc.Client;
  requestType: protobuf.Type;
}

/** host:port without scheme, and whether the scheme asked for TLS. */
export function parseTarget(raw: string): { target: string; tls: boolean } {
  const m = /^(grpcs?|https?):\/\//i.exec(raw.trim());
  const rest = (m ? raw.trim().slice(m[0].length) : raw.trim()).replace(/\/+$/, "");
  return { target: rest, tls: m ? /^(grpcs|https)$/i.test(m[1]!) : false };
}

function credentials(settings: GrpcSettings, forceTls: boolean, context: SendContext | null): grpc.ChannelCredentials {
  const mode = forceTls && settings.tls === "none" ? "tls" : settings.tls;
  if (mode === "none") return grpc.credentials.createInsecure();
  const read = (path: string) => (path ? readFileSync(resolveVariables(path, context)) : null);
  try {
    return grpc.credentials.createSsl(read(settings.caFile), read(settings.keyFile), read(settings.certFile), mode === "insecure" ? { rejectUnauthorized: false, checkServerIdentity: () => undefined } : {});
  } catch (err) {
    throw new SchemaError("TLS_FILES", `No se pudieron leer los certificados: ${(err as Error).message}`);
  }
}

function metadataOf(rows: GrpcRequest["metadata"], context: SendContext | null): grpc.Metadata {
  const md = new grpc.Metadata();
  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue;
    const key = row.key.trim().toLowerCase();
    const value = resolveVariables(row.value, context);
    // Keys ending in -bin carry binary values, given as base64.
    md.add(key, key.endsWith("-bin") ? Buffer.from(value, "base64") : value);
  }
  return md;
}

const pairs = (md: grpc.Metadata | undefined, context: SendContext | null) =>
  Object.entries(md?.getMap() ?? {}).map(([key, v]) => ({ key, value: maskSecrets(Buffer.isBuffer(v) ? v.toString("base64") : String(v), context) }));

export const grpcProvider: ProviderManifest = {
  name: "grpc",
  methods: ["describe", "start", "send", "end", "cancel"],
  load: (_deps, ctx) => {
    const calls = new Map<string, ActiveCall>();
    const reflected = new Map<string, protobuf.Root>();
    const emit = (event: GrpcEvent) => ctx.emit("grpc", event.type, event);

    const newClient = (request: GrpcRequest, context: SendContext | null) => {
      const { target, tls } = parseTarget(resolveVariables(request.target, context));
      if (!target) throw new SchemaError("NO_TARGET", "Escribe la dirección del servidor (host:puerto)");
      return new grpc.Client(target, credentials(request.settings, tls, context), {
        "grpc.primary_user_agent": USER_AGENT,
        "grpc.max_receive_message_length": MAX_MESSAGE,
        "grpc.max_send_message_length": MAX_MESSAGE,
      });
    };

    const reflectionKey = (request: GrpcRequest, context: SendContext | null) => JSON.stringify([resolveVariables(request.target, context), request.settings]);

    /** The schema of a request: .proto files are read each time (they may have changed); reflection is cached per server. */
    const schemaFor = async (request: GrpcRequest, context: SendContext | null, fresh: boolean): Promise<protobuf.Root> => {
      const def: GrpcDefinition = request.definition;
      if (def.source === "files") return loadProtoFiles(def.files, def.importPaths);
      const key = reflectionKey(request, context);
      const cached = reflected.get(key);
      if (cached && !fresh) return cached;
      const client = newClient(request, context);
      try {
        const root = await loadByReflection(client, metadataOf(request.metadata, context), REFLECTION_TIMEOUT_MS);
        reflected.set(key, root);
        return root;
      } finally {
        client.close();
      }
    };

    const failure = (err: unknown, context: SendContext | null) => {
      if (err instanceof SchemaError) return { kind: "error" as const, code: err.code, message: maskSecrets(err.message, context) };
      const e = err as grpc.ServiceError;
      const code = typeof e.code === "number" ? (STATUS_NAME[e.code] ?? "UNKNOWN") : "GRPC_FAILED";
      return { kind: "error" as const, code, message: maskSecrets(e.details || e.message || String(err), context) };
    };

    const message = (callId: string, dir: "in" | "out", value: unknown, context: SendContext | null): GrpcEvent => {
      const text = JSON.stringify(value, null, 2) ?? "";
      const truncated = text.length > MAX_TEXT_SHOWN;
      return { type: "message", callId, dir, at: Date.now(), text: maskSecrets(truncated ? text.slice(0, MAX_TEXT_SHOWN) : text, context), size: Buffer.byteLength(text), truncated };
    };

    const describeMethod = async (params: unknown): Promise<MethodResult<"grpc.describe">> => {
      const { request, context = null } = params as MethodParams<"grpc.describe">;
      try {
        const root = await schemaFor(request, context, true);
        return { kind: "ok", services: describe(root), files: request.definition.source === "files" ? root.files : [] };
      } catch (err) {
        return failure(err, context);
      }
    };

    const start = async (params: unknown): Promise<MethodResult<"grpc.start">> => {
      const { callId, request, context = null } = params as MethodParams<"grpc.start">;
      if (calls.has(callId)) return { kind: "error", code: "ALREADY_STARTED", message: "La llamada ya está en curso" };
      let client: grpc.Client | null = null;
      try {
        if (!request.service || !request.method) throw new SchemaError("NO_METHOD", "Elige un servicio y un método");
        const root = await schemaFor(request, context, false);
        const method = findMethod(root, request.service, request.method);
        const type = callType(method);
        const requestType = method.resolvedRequestType!;
        const responseType = method.resolvedResponseType!;
        const first = type === "unary" || type === "server" ? parseMessage(requestType, resolveVariables(request.message, context)) : null;
        client = newClient(request, context);
        const path = `/${request.service}/${request.method}`;
        const metadata = metadataOf(request.metadata, context);
        const options: grpc.CallOptions = request.settings.deadlineMs > 0 ? { deadline: Date.now() + request.settings.deadlineMs } : {};
        const startedAt = performance.now();
        const ser = encoder(requestType);
        const des = decoder(responseType);
        const onData = (value: unknown) => emit(message(callId, "in", value, context));

        let call: ActiveCall["call"];
        switch (type) {
          case "unary":
            call = client.makeUnaryRequest(path, ser, des, first, metadata, options, (err, value) => {
              if (!err) onData(value);
            });
            break;
          case "server": {
            const stream = client.makeServerStreamRequest(path, ser, des, first, metadata, options);
            stream.on("data", onData);
            stream.on("error", () => {}); // Errors also arrive as the final status; unhandled they would throw.
            call = stream;
            break;
          }
          case "client":
            call = client.makeClientStreamRequest(path, ser, des, metadata, options, (err, value) => {
              if (!err) onData(value);
            });
            break;
          case "bidi": {
            const stream = client.makeBidiStreamRequest(path, ser, des, metadata, options);
            stream.on("data", onData);
            stream.on("error", () => {});
            call = stream;
            break;
          }
        }
        if (type === "client") (call as grpc.ClientWritableStream<unknown>).on("error", () => {});
        call.on("metadata", (md: grpc.Metadata) => emit({ type: "headers", callId, at: Date.now(), headers: pairs(md, context) }));
        call.on("status", (s: grpc.StatusObject) => {
          calls.delete(callId);
          client?.close();
          emit({
            type: "status",
            callId,
            at: Date.now(),
            code: s.code,
            name: STATUS_NAME[s.code] ?? "UNKNOWN",
            details: maskSecrets(s.details ?? "", context),
            trailers: pairs(s.metadata, context),
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        });
        calls.set(callId, { id: callId, type, context, call, client, requestType });
        if (first) emit(message(callId, "out", first, context));
        return { kind: "started", type };
      } catch (err) {
        client?.close();
        return failure(err, context);
      }
    };

    const send = (params: unknown): MethodResult<"grpc.send"> => {
      const { callId, message: text, context = null } = params as MethodParams<"grpc.send">;
      const active = calls.get(callId);
      if (!active || (active.type !== "client" && active.type !== "bidi")) return { sent: false, error: "La llamada no admite más mensajes" };
      if (context) active.context = context;
      try {
        const value = parseMessage(active.requestType, resolveVariables(text, active.context));
        (active.call as grpc.ClientWritableStream<unknown>).write(value);
        emit(message(callId, "out", value, active.context));
        return { sent: true, error: null };
      } catch (err) {
        return { sent: false, error: maskSecrets((err as Error).message, active.context) };
      }
    };

    const end = (params: unknown): MethodResult<"grpc.end"> => {
      const { callId } = params as MethodParams<"grpc.end">;
      const active = calls.get(callId);
      if (!active || (active.type !== "client" && active.type !== "bidi")) return { ended: false };
      (active.call as grpc.ClientWritableStream<unknown>).end();
      return { ended: true };
    };

    const cancel = (params: unknown): MethodResult<"grpc.cancel"> => {
      const { callId } = params as MethodParams<"grpc.cancel">;
      const active = calls.get(callId);
      if (!active) return { cancelled: false };
      active.call.cancel();
      return { cancelled: true };
    };

    return { describe: describeMethod, start, send, end, cancel };
  },
};

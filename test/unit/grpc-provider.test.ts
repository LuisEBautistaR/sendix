import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderManager } from "../../src/engine/provider-manager";
import { grpcProvider, parseTarget } from "../../src/engine/providers/grpc";
import { emptyGrpc, type DescribeResult, type GrpcEvent, type GrpcRequest, type StartResult } from "@shared/grpc";
import type { SendContext } from "@shared/http";
import { PROTO_DIR, PROTO_FILE, startGrpcServer, type GrpcTestServer } from "../fixtures/grpc-server";

let server: GrpcTestServer;
const events: GrpcEvent[] = [];
const manager = new ProviderManager([grpcProvider], { testMode: false, emit: (_s, _n, data) => events.push(data as GrpcEvent) });
const call = { id: "x", signal: new AbortController().signal };
let n = 0;

const request = (over: Partial<GrpcRequest> = {}): GrpcRequest => ({ ...emptyGrpc(server.target), service: "tienda.v1.Tienda", ...over });
const files = { source: "files" as const, files: [PROTO_FILE], importPaths: [] };
const describeWith = (r: GrpcRequest) => manager.invoke("grpc.describe", { request: r }, call) as Promise<DescribeResult>;
const start = async (r: GrpcRequest, context: SendContext | null = null) => {
  const callId = `call-test-${++n}`;
  const result = (await manager.invoke("grpc.start", { callId, request: r, context }, call)) as StartResult;
  return { callId, result };
};
const of = (callId: string) => events.filter((e) => e.callId === callId);
async function finished(callId: string) {
  const until = Date.now() + 8000;
  for (;;) {
    const status = of(callId).find((e): e is Extract<GrpcEvent, { type: "status" }> => e.type === "status");
    if (status) return status;
    if (Date.now() > until) throw new Error(`No status for ${callId}: ${JSON.stringify(of(callId))}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const messages = (callId: string, dir: "in" | "out") => of(callId).flatMap((e) => (e.type === "message" && e.dir === dir ? [JSON.parse(e.text)] : []));

beforeAll(async () => {
  server = await startGrpcServer();
});
afterAll(() => server.close());

describe("grpc targets", () => {
  it("strips the scheme and notes when it asks for TLS", () => {
    expect(parseTarget("grpcs://api.test:443/")).toEqual({ target: "api.test:443", tls: true });
    expect(parseTarget("localhost:50051")).toEqual({ target: "localhost:50051", tls: false });
  });
});

describe("grpc describe", () => {
  it("lists services through server reflection, with call types and examples", async () => {
    const result = await describeWith(request());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.services.map((s) => s.name)).toEqual(["tienda.v1.Tienda"]);
    const methods = result.services[0]!.methods;
    expect(methods.map((m) => [m.name, m.type])).toEqual([
      ["ObtenerProducto", "unary"],
      ["ListarProductos", "server"],
      ["CargarPedido", "client"],
      ["Chat", "bidi"],
    ]);
    expect(JSON.parse(methods[1]!.example)).toEqual({ categoria: "CATEGORIA_DESCONOCIDA", limite: 0 });
  });

  it("reads .proto files with imports, including Google's well-known types", async () => {
    const result = await describeWith(request({ definition: { ...files, importPaths: [PROTO_DIR] } }));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files.some((f) => f.endsWith("dinero.proto"))).toBe(true);
    const responseExample = result.services[0]!.methods.find((m) => m.name === "ObtenerProducto")!;
    expect(responseExample.responseType).toBe("tienda.v1.Producto");
  });

  it("explains a broken .proto and a server without gRPC", async () => {
    expect(await describeWith(request({ definition: { source: "files", files: [`${PROTO_DIR}/no-existe.proto`], importPaths: [] } }))).toMatchObject({ kind: "error", code: "PROTO_INVALID" });
    expect(await describeWith(request({ target: "127.0.0.1:9" }))).toMatchObject({ kind: "error", code: "UNAVAILABLE" });
  });
});

describe("grpc calls", () => {
  it("makes a unary call with metadata and variables, and returns headers and trailers", async () => {
    const ctx: SendContext = { authChain: [], eventChain: [], collectionVariables: [], environment: [{ key: "id", value: "prd_1", enabled: true }, { key: "tienda", value: "cdmx", enabled: true }] };
    const { callId, result } = await start(
      request({ definition: files, method: "ObtenerProducto", message: '{ "id": "{{id}}" }', metadata: [{ key: "X-Tienda", value: "{{tienda}}", enabled: true }] }),
      ctx,
    );
    expect(result).toEqual({ kind: "started", type: "unary" });
    const status = await finished(callId);
    expect(status).toMatchObject({ code: 0, name: "OK", trailers: [{ key: "x-servidor", value: "pruebas" }] });
    expect(of(callId).find((e) => e.type === "headers")).toMatchObject({ headers: expect.arrayContaining([{ key: "x-tienda-vista", value: "cdmx" }]) });
    expect(messages(callId, "out")).toEqual([{ id: "prd_1" }]);
    expect(messages(callId, "in")[0]).toMatchObject({ id: "prd_1", categoria: "CAFE", precio: { moneda: "MXN", centavos: "18900" } });
  });

  it("reports a gRPC error status with its details", async () => {
    const { callId } = await start(request({ method: "ObtenerProducto", message: '{ "id": "nada" }' }));
    expect(await finished(callId)).toMatchObject({ code: 5, name: "NOT_FOUND", details: "No existe el producto nada" });
  });

  it("streams server messages", async () => {
    const { callId, result } = await start(request({ method: "ListarProductos", message: '{ "categoria": "CAFE" }' }));
    expect(result).toEqual({ kind: "started", type: "server" });
    await finished(callId);
    expect(messages(callId, "in").map((p) => p.id)).toEqual(["prd_1", "prd_3"]);
  });

  it("sends a client stream and gets one summary", async () => {
    const { callId } = await start(request({ method: "CargarPedido" }));
    for (const qty of [2, 3]) {
      expect(await manager.invoke("grpc.send", { callId, message: `{ "producto_id": "prd_1", "cantidad": ${qty} }` }, call)).toEqual({ sent: true, error: null });
    }
    await manager.invoke("grpc.end", { callId }, call);
    await finished(callId);
    expect(messages(callId, "in")).toEqual([{ lineas: 2, unidades: 5 }]);
  });

  it("talks both ways, rejects unknown fields and can be cancelled", async () => {
    const { callId } = await start(request({ method: "Chat" }));
    await manager.invoke("grpc.send", { callId, message: '{ "texto": "hola" }' }, call);
    expect(await manager.invoke("grpc.send", { callId, message: '{ "txt": "x" }' }, call)).toEqual({ sent: false, error: "Campos que no existen en tienda.v1.Mensaje: txt" });
    const until = Date.now() + 5000;
    while (messages(callId, "in").length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(messages(callId, "in")).toEqual([{ texto: "eco: hola" }]);
    await manager.invoke("grpc.cancel", { callId }, call);
    expect(await finished(callId)).toMatchObject({ name: "CANCELLED" });
  });

  it("checks the message before calling", async () => {
    expect((await start(request({ method: "ObtenerProducto", message: "{ roto" }))).result).toMatchObject({ kind: "error", code: "INVALID_JSON" });
    expect((await start(request({ method: "NoExiste" }))).result).toMatchObject({ kind: "error", code: "NO_METHOD" });
  });
});

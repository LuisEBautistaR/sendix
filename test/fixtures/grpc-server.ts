/** Local gRPC server for tests (plaintext, with server reflection). Never a real external API. */
import { resolve } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";

export const PROTO_DIR = resolve(import.meta.dirname, "proto");
export const PROTO_FILE = resolve(PROTO_DIR, "tienda.proto");

export interface GrpcTestServer {
  target: string;
  close(): Promise<void>;
}

type Producto = { id: string; nombre: string; categoria: string; precio: { moneda: string; centavos: string }; etiquetas: string[] };

const CATALOGO: Producto[] = [
  { id: "prd_1", nombre: "Café de Veracruz", categoria: "CAFE", precio: { moneda: "MXN", centavos: "18900" }, etiquetas: ["tostado medio"] },
  { id: "prd_2", nombre: "Té verde", categoria: "TE", precio: { moneda: "MXN", centavos: "9500" }, etiquetas: [] },
  { id: "prd_3", nombre: "Café de Chiapas", categoria: "CAFE", precio: { moneda: "MXN", centavos: "21000" }, etiquetas: ["orgánico"] },
];

export async function startGrpcServer(): Promise<GrpcTestServer> {
  const definition = protoLoader.loadSync(PROTO_FILE, { includeDirs: [PROTO_DIR], keepCase: true, longs: String, enums: String, defaults: true });
  const pkg = grpc.loadPackageDefinition(definition) as unknown as { tienda: { v1: { Tienda: grpc.ServiceClientConstructor } } };
  const server = new grpc.Server();

  server.addService(pkg.tienda.v1.Tienda.service, {
    ObtenerProducto: (call: grpc.ServerUnaryCall<{ id: string }, Producto>, done: grpc.sendUnaryData<Producto>) => {
      // Metadata goes back as a response header and a trailer, so tests can see both.
      const tienda = call.metadata.get("x-tienda")[0];
      const header = new grpc.Metadata();
      header.set("x-tienda-vista", String(tienda ?? "ninguna"));
      call.sendMetadata(header);
      const found = CATALOGO.find((p) => p.id === call.request.id);
      const trailer = new grpc.Metadata();
      trailer.set("x-servidor", "pruebas");
      if (!found) return done({ code: grpc.status.NOT_FOUND, details: `No existe el producto ${call.request.id}`, metadata: trailer });
      done(null, found, trailer);
    },
    ListarProductos: (call: grpc.ServerWritableStream<{ categoria: string; limite: number }, Producto>) => {
      const list = CATALOGO.filter((p) => call.request.categoria === "CATEGORIA_DESCONOCIDA" || p.categoria === call.request.categoria);
      for (const p of list.slice(0, call.request.limite || list.length)) call.write(p);
      call.end();
    },
    CargarPedido: (call: grpc.ServerReadableStream<{ producto_id: string; cantidad: number }, unknown>, done: grpc.sendUnaryData<{ lineas: number; unidades: number }>) => {
      let lineas = 0;
      let unidades = 0;
      call.on("data", (l: { cantidad: number }) => {
        lineas++;
        unidades += l.cantidad;
      });
      call.on("end", () => done(null, { lineas, unidades }));
    },
    Chat: (call: grpc.ServerDuplexStream<{ texto: string }, { texto: string }>) => {
      call.on("data", (m: { texto: string }) => call.write({ texto: `eco: ${m.texto}` }));
      call.on("end", () => call.end());
    },
  });
  new ReflectionService(definition).addToServer(server);

  const port = await new Promise<number>((ok, fail) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, p) => (err ? fail(err) : ok(p))));
  return {
    target: `127.0.0.1:${port}`,
    close: () => new Promise((done) => server.tryShutdown(() => done())),
  };
}

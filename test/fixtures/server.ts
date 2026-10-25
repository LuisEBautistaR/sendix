/** Local HTTP, WebSocket and Socket.IO server for tests: Sendix never calls real external APIs in tests. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { Server as SocketServer } from "socket.io";

export interface TestServer {
  url: string;
  /** ws://… base of the same server. */
  wsUrl: string;
  close(): Promise<void>;
}

const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function startTestServer(): Promise<TestServer> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (path === "/json") {
      return json(res, 200, { productos: [{ id: "prd_1", nombre: "Café de Veracruz", precio: 189 }], total: 1 }, { "Set-Cookie": "sid=abc123; Path=/; HttpOnly" });
    }
    if (path === "/echo") {
      return json(res, 200, { method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body: await readBody(req) });
    }
    if (path === "/redirect") {
      res.writeHead(302, { Location: "/json" });
      return res.end();
    }
    if (path === "/slow") {
      const ms = Number(url.searchParams.get("ms") ?? 5000);
      const timer = setTimeout(() => json(res, 200, { waited: ms }), ms);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    const status = /^\/status\/(\d{3})$/.exec(path);
    if (status) return json(res, Number(status[1]), { error: "Datos no válidos", status: Number(status[1]) });
    if (path === "/text") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("hola desde el servidor de pruebas");
    }
    json(res, 404, { error: "No existe" });
  });
  attachWebSocket(server);
  const io = attachSocketIo(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        wsUrl: `ws://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            io.disconnectSockets(true);
            void io.close();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * /ws: greets with the handshake it saw, echoes text and binary, and on command
 * sends binary ("binario"), closes with 4000 ("cerrar") or drops the TCP
 * connection without a close frame ("cortar", for reconnection tests).
 * /ws/privado answers 401 unless the X-Clave header is "abrete".
 */
function attachWebSocket(server: ReturnType<typeof createServer>): void {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => [...protocols][0] ?? false });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/ws/privado" && req.headers["x-clave"] !== "abrete") {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if (path !== "/ws" && path !== "/ws/privado") return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ hola: true, protocolo: ws.protocol, agente: req.headers["user-agent"], clave: req.headers["x-clave"] ?? null }));
      ws.on("message", (data, isBinary) => {
        const text = isBinary ? null : data.toString();
        if (text === "binario") ws.send(Buffer.from([0, 1, 2, 250]));
        else if (text === "cerrar") ws.close(4000, "adiós");
        else if (text === "cortar") ws.terminate();
        else ws.send(isBinary ? data : `eco: ${text}`, { binary: isBinary });
      });
    });
  });
}

/** Socket.IO on /socket.io: "bienvenida" on connect, "eco" echoes, "sumar" answers through the ack. */
function attachSocketIo(server: ReturnType<typeof createServer>): SocketServer {
  const io = new SocketServer(server, { destroyUpgrade: false, cors: { origin: "*" } });
  io.on("connection", (socket) => {
    socket.emit("bienvenida", { id: socket.id, auth: socket.handshake.auth, cabecera: socket.handshake.headers["x-tienda"] ?? null });
    socket.on("eco", (...args: unknown[]) => socket.emit("eco", ...args));
    socket.on("sumar", (nums: number[], ack?: (total: number) => void) => ack?.(nums.reduce((a, b) => a + b, 0)));
    socket.on("echar", () => socket.disconnect(true));
  });
  return io;
}

/**
 * HTTPS servers signed by the synthetic test CA in ./tls (one asks for a client certificate)
 * and a forward HTTP proxy that answers by itself, to test proxy and certificate settings
 * without touching real networks.
 */
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { resolve } from "node:path";

export const TLS_DIR = resolve(import.meta.dirname, "tls");
const file = (name: string) => readFileSync(resolve(TLS_DIR, name));

export interface NetworkFixtures {
  /** https://127.0.0.1:port signed by the test CA. */
  httpsUrl: string;
  /** Same, but the TLS handshake requires a client certificate from the test CA. */
  mtlsUrl: string;
  mtlsPort: number;
  proxyPort: number;
  /** Requests the proxy saw: absolute URL and Proxy-Authorization header. */
  proxied: Array<{ url: string; auth: string | null }>;
  close(): Promise<void>;
}

const listen = (server: ReturnType<typeof createHttpServer>) =>
  new Promise<number>((done) => server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port)));

export async function startNetworkFixtures(): Promise<NetworkFixtures> {
  const tls = { key: file("server.key"), cert: file("server.crt") };
  const https = createHttpsServer(tls, (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ seguro: true, path: req.url }));
  });
  const mtls = createHttpsServer({ ...tls, ca: file("ca.crt"), requestCert: true, rejectUnauthorized: true }, (req, res) => {
    const peer = (req.socket as TLSSocket).getPeerCertificate();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cliente: peer.subject?.CN ?? null }));
  });
  const proxied: NetworkFixtures["proxied"] = [];
  const proxy = createHttpServer((req, res) => {
    const auth = req.headers["proxy-authorization"];
    proxied.push({ url: req.url ?? "", auth: typeof auth === "string" ? auth : null });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ viaProxy: true, url: req.url, auth: auth ?? null }));
  });
  const [httpsPort, mtlsPort, proxyPort] = await Promise.all([listen(https), listen(mtls), listen(proxy)]);
  const close = (s: { close(cb: () => void): void; closeAllConnections(): void }) =>
    new Promise<void>((done) => {
      s.closeAllConnections();
      s.close(() => done());
    });
  return {
    httpsUrl: `https://127.0.0.1:${httpsPort}`,
    mtlsUrl: `https://127.0.0.1:${mtlsPort}`,
    mtlsPort,
    proxyPort,
    proxied,
    close: async () => {
      await Promise.all([close(https), close(mtls), close(proxy)]);
    },
  };
}

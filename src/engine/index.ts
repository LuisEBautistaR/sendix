/// <reference types="electron" />
/**
 * Engine entry point. Runs in an Electron utilityProcess forked by main: no
 * window, no Electron main APIs, and it never sees the renderer directly. Main
 * hands it a MessagePort in the first message; every call arrives through it.
 */
import { handshakeSchema, type FromEngine } from "@shared/rpc";
import { ProviderManager, type ProviderManifest } from "./provider-manager";
import { createRpcServer } from "./rpc-server";
import { systemProvider } from "./providers/system";
import { diagnosticsProvider } from "./providers/diagnostics";
import { httpProvider } from "./providers/http";
import { importerProvider } from "./providers/importer";
import { realtimeProvider } from "./providers/realtime";
import { grpcProvider } from "./providers/grpc";

const PROVIDERS: readonly ProviderManifest[] = [systemProvider, httpProvider, realtimeProvider, grpcProvider, importerProvider, diagnosticsProvider];

const log = (message: string, detail?: unknown): void => {
  if (detail === undefined) console.log(`[engine] ${message}`);
  else console.error(`[engine] ${message}`, detail);
};

const parentPort = process.parentPort;
if (!parentPort) {
  console.error("[engine] Must run as an Electron utilityProcess");
  process.exit(1);
}

parentPort.once("message", ({ data, ports }) => {
  const handshake = handshakeSchema.safeParse(data);
  const port = ports[0];
  if (!handshake.success || !port) {
    log("Invalid handshake from main", handshake.success ? "missing port" : handshake.error.issues);
    process.exit(2);
  }
  const { testMode } = handshake.data;
  const send = (message: FromEngine): void => port.postMessage(message);

  const manager = new ProviderManager(PROVIDERS, {
    testMode,
    emit: (stream, name, eventData) => send({ kind: "event", stream, name, data: eventData }),
  });
  const server = createRpcServer({ manager, send, testMode, log });

  port.on("message", ({ data: message }) => server.handle(message));
  port.on("close", () => {
    log("Port closed by main, exiting");
    process.exit(0);
  });
  port.start();

  send({ kind: "event", stream: "engine", name: "ready", data: { pid: process.pid, providers: manager.providerNames() } });
  log(`Ready (pid ${process.pid}, providers: ${manager.providerNames().join(", ")})`);
});

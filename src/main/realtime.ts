/**
 * Relays WebSocket, Socket.IO and gRPC events from the engine to the windows.
 * Main keeps the ids of open connections and calls so that, if the engine dies,
 * each one ends in the UI with a close or status event instead of hanging.
 */
import { BrowserWindow } from "electron";
import { IpcChannels } from "@shared/ipc";
import { realtimeEventSchema, type RealtimeEvent } from "@shared/realtime";
import { grpcEventSchema, type GrpcEvent } from "@shared/grpc";
import type { EngineHost } from "./engine-host";

export class RealtimeRelay {
  readonly #open = new Set<string>();
  readonly #calls = new Set<string>();

  constructor(engine: EngineHost) {
    engine.on("event", (envelope) => {
      if (envelope.stream === "grpc") {
        const event = grpcEventSchema.safeParse(envelope.data);
        if (!event.success) return console.error("[main] Dropped an invalid gRPC event", event.error.issues);
        if (event.data.type === "status") this.#calls.delete(event.data.callId);
        return this.#send(IpcChannels.grpcEvent, event.data);
      }
      if (envelope.stream !== "realtime") return;
      const parsed = realtimeEventSchema.safeParse(envelope.data);
      if (!parsed.success) {
        console.error("[main] Dropped an invalid realtime event", parsed.error.issues);
        return;
      }
      if (parsed.data.type === "closed") this.#open.delete(parsed.data.connId);
      this.#broadcast(parsed.data);
    });
    engine.on("status", (status) => {
      if (status.state === "ready") return;
      for (const callId of this.#calls) {
        const lost: GrpcEvent = { type: "status", callId, at: Date.now(), code: 14, name: "UNAVAILABLE", details: "El motor se detuvo y la llamada se perdió", trailers: [], elapsedMs: 0 };
        this.#send(IpcChannels.grpcEvent, lost);
      }
      this.#calls.clear();
      if (this.#open.size === 0) return;
      for (const connId of this.#open) {
        this.#broadcast({ type: "closed", connId, at: Date.now(), code: null, reason: "El motor se detuvo y la conexión se perdió", byUser: false });
      }
      this.#open.clear();
    });
  }

  /** Called after a connect call succeeds. */
  opened(connId: string): void {
    this.#open.add(connId);
  }

  /** Called after a gRPC call starts. */
  callStarted(callId: string): void {
    this.#calls.add(callId);
  }

  #broadcast(event: RealtimeEvent): void {
    this.#send(IpcChannels.realtimeEvent, event);
  }

  #send(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  }
}

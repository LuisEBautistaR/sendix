import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from "electron";
import { ErrorCodes, PROTOCOL_VERSION, fromEngineSchema, type EventEnvelope, type Handshake, type Outcome, type ToEngine } from "@shared/rpc";
import { methods, type MethodName, type MethodParams, type MethodResult } from "@shared/methods";
import type { EngineStatus } from "@shared/ipc";

export interface EngineHostOptions {
  entry: string;
  testMode: boolean;
  /** App version, reported by the engine in its User-Agent. */
  version: string;
  log: (message: string, detail?: unknown) => void;
}

interface Pending {
  method: MethodName;
  resolve: (outcome: Outcome<unknown>) => void;
  timer: NodeJS.Timeout;
}

const READY_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
/** More crashes than this within the window marks the engine as failed instead of restarting forever. */
const CRASH_BUDGET = 5;
const CRASH_WINDOW_MS = 60_000;

type Events = { status: [EngineStatus]; event: [EventEnvelope] };

/**
 * Owns the engine utilityProcess: starts it, restarts it with backoff when it
 * dies, and turns calls into envelopes over a MessagePort.
 */
export class EngineHost extends EventEmitter<Events> {
  readonly #opts: EngineHostOptions;
  #child: UtilityProcess | null = null;
  #port: MessagePortMain | null = null;
  #pending = new Map<string, Pending>();
  #readyWaiters: Array<() => void> = [];
  #readyTimer: NodeJS.Timeout | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #crashes: number[] = [];
  #stopping = false;
  #status: EngineStatus = { state: "stopped", pid: null, restarts: 0, readySince: null, lastExit: null };

  constructor(opts: EngineHostOptions) {
    super();
    this.#opts = opts;
  }

  get status(): EngineStatus {
    return { ...this.#status };
  }

  start(): void {
    this.#stopping = false;
    this.#spawn();
  }

  #setStatus(patch: Partial<EngineStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.emit("status", this.status);
  }

  #spawn(): void {
    const { entry, testMode, log } = this.#opts;
    this.#setStatus({ state: this.#status.restarts > 0 ? "restarting" : "starting", pid: null, readySince: null });

    const child = utilityProcess.fork(entry, [], {
      serviceName: "Sendix Engine",
      stdio: "pipe",
      env: { ...process.env, SENDIX_VERSION: this.#opts.version },
    });
    this.#child = child;
    child.stdout?.on("data", (chunk: Buffer) => log(chunk.toString().trimEnd()));
    child.stderr?.on("data", (chunk: Buffer) => log(chunk.toString().trimEnd()));

    const { port1, port2 } = new MessageChannelMain();
    this.#port = port1;
    port1.on("message", ({ data }) => this.#onMessage(data));
    port1.start();
    const handshake: Handshake = { type: "connect", protocol: PROTOCOL_VERSION, testMode };
    child.postMessage(handshake, [port2]);

    child.once("exit", (code) => this.#onExit(child, code));
    this.#readyTimer = setTimeout(() => {
      log(`Engine did not become ready within ${READY_TIMEOUT_MS} ms; killing it`);
      child.kill();
    }, READY_TIMEOUT_MS);
  }

  #onMessage(raw: unknown): void {
    const parsed = fromEngineSchema.safeParse(raw);
    if (!parsed.success) {
      this.#opts.log("Dropped an invalid message from the engine", parsed.error.issues);
      return;
    }
    const message = parsed.data;
    if (message.kind === "event") {
      if (message.stream === "engine" && message.name === "ready") this.#onReady();
      this.emit("event", message);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (!message.ok) {
      pending.resolve({ ok: false, error: message.error });
      return;
    }
    // Main re-validates results: a compromised or buggy engine cannot hand the UI arbitrary shapes.
    const result = methods[pending.method].result.safeParse(message.value);
    pending.resolve(
      result.success
        ? { ok: true, value: result.data }
        : { ok: false, error: { code: ErrorCodes.invalidResult, message: `Invalid result from ${pending.method}` } },
    );
  }

  #onReady(): void {
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    this.#setStatus({ state: "ready", pid: this.#child?.pid ?? null, readySince: Date.now() });
    for (const wake of this.#readyWaiters.splice(0)) wake();
  }

  #onExit(child: UtilityProcess, code: number): void {
    if (child !== this.#child) return;
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    this.#port?.close();
    this.#port = null;
    this.#child = null;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { code: ErrorCodes.engineExited, message: "The engine stopped before answering" } });
      this.#pending.delete(id);
    }

    const now = Date.now();
    this.#status.lastExit = { code, at: now };
    if (this.#stopping) {
      this.#setStatus({ state: "stopped", pid: null, readySince: null });
      return;
    }

    this.#opts.log(`Engine exited with code ${code}`);
    this.#crashes = [...this.#crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.#crashes.length > CRASH_BUDGET) {
      this.#setStatus({ state: "failed", pid: null, readySince: null });
      for (const wake of this.#readyWaiters.splice(0)) wake();
      return;
    }
    const delay = Math.min(250 * 2 ** (this.#crashes.length - 1), 5_000);
    this.#setStatus({ state: "restarting", pid: null, readySince: null, restarts: this.#status.restarts + 1 });
    this.#restartTimer = setTimeout(() => this.#spawn(), delay);
  }

  #whenReady(timeoutMs: number): Promise<boolean> {
    if (this.#status.state === "ready") return Promise.resolve(true);
    if (this.#status.state === "failed" || this.#stopping) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.#readyWaiters.push(() => {
        clearTimeout(timer);
        resolve(this.#status.state === "ready");
      });
    });
  }

  /** Params must already be validated by the caller. Never throws. */
  async call<M extends MethodName>(
    method: M,
    params: MethodParams<M>,
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<Outcome<MethodResult<M>>> {
    if (!(await this.#whenReady(READY_TIMEOUT_MS)) || !this.#port) {
      return { ok: false, error: { code: ErrorCodes.engineUnavailable, message: `The engine is ${this.#status.state}` } };
    }
    const port = this.#port;
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        port.postMessage({ kind: "cancel", id } satisfies ToEngine);
        resolve({ ok: false, error: { code: ErrorCodes.timeout, message: `${method} timed out after ${timeoutMs} ms` } });
      }, timeoutMs);
      this.#pending.set(id, { method, resolve: resolve as Pending["resolve"], timer });
      port.postMessage({ kind: "call", id, method, params } satisfies ToEngine);
    });
  }

  stop(): void {
    this.#stopping = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    this.#child?.kill();
  }
}

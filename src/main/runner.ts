/**
 * Collection runner. Main walks the collection (or one folder) and sends each
 * request through the engine in order, so every send gets the same context as
 * a manual one and what scripts set carries over to the next request.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { BrowserWindow, ipcMain } from "electron";
import { ErrorCodes, type Outcome } from "@shared/rpc";
import { IpcChannels } from "@shared/ipc";
import type { TreeNode } from "@shared/collection";
import { runConfigSchema, type DataRow, type RunConfig, type RunEvent, type RunItemResult } from "@shared/runner";
import type { EngineHost } from "./engine-host";
import type { WorkspaceController } from "./workspace/controller";
import { isTrustedSender } from "./security";

const HTTP_CALL_SLACK_MS = 10_000;

interface ActiveRun {
  id: string;
  stopped: boolean;
  currentRequestId: string | null;
}

/** Request ids of a subtree, depth first, in the order they appear in the collection. */
export function requestOrder(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "request" ? [n.id] : requestOrder(n.children ?? [])));
}

function findNode(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children ?? [], id);
    if (found) return found;
  }
  return null;
}

export class RunnerController {
  #active: ActiveRun | null = null;

  constructor(
    private readonly engine: EngineHost,
    private readonly workspaces: WorkspaceController,
  ) {}

  register(): void {
    ipcMain.handle(IpcChannels.runnerStart, (event, config: unknown): Outcome<{ runId: string }> => {
      if (!isTrustedSender(event.senderFrame)) return { ok: false, error: { code: ErrorCodes.forbidden, message: "Untrusted sender" } };
      const parsed = runConfigSchema.safeParse(config);
      if (!parsed.success) return { ok: false, error: { code: ErrorCodes.invalidParams, message: parsed.error.message } };
      if (this.#active) return { ok: false, error: { code: "RUNNER_BUSY", message: "Ya hay una ejecución en curso" } };
      const ws = this.workspaces.workspace;
      const collection = ws?.snapshot().collections.find((c) => c.id === parsed.data.collectionId);
      if (!collection) return { ok: false, error: { code: "NOT_FOUND", message: "La colección ya no existe" } };
      const root = parsed.data.folderId ? findNode(collection.tree, parsed.data.folderId) : null;
      if (parsed.data.folderId && !root) return { ok: false, error: { code: "NOT_FOUND", message: "La carpeta ya no existe" } };
      const items = requestOrder(root ? (root.children ?? []) : collection.tree);
      if (!items.length) return { ok: false, error: { code: "EMPTY", message: "No hay peticiones que ejecutar" } };

      const run: ActiveRun = { id: randomUUID(), stopped: false, currentRequestId: null };
      this.#active = run;
      void this.#run(run, parsed.data, items);
      return { ok: true, value: { runId: run.id } };
    });

    ipcMain.handle(IpcChannels.runnerStop, (event, runId: unknown): boolean => {
      if (!isTrustedSender(event.senderFrame)) return false;
      const run = this.#active;
      if (!run || run.id !== runId) return false;
      run.stopped = true;
      if (run.currentRequestId) void this.engine.call("http.cancel", { requestId: run.currentRequestId });
      return true;
    });
  }

  #emit(event: RunEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IpcChannels.runnerEvent, event);
    }
  }

  async #run(run: ActiveRun, config: RunConfig, items: string[]): Promise<void> {
    this.#emit({ type: "started", runId: run.id, requests: items.length, iterations: config.iterations });
    let error: string | null = null;
    let sequence = 0;
    try {
      for (let iteration = 0; iteration < config.iterations && !run.stopped; iteration++) {
        const data = config.data?.length ? (config.data[Math.min(iteration, config.data.length - 1)] ?? null) : null;
        for (const itemId of items) {
          if (run.stopped) break;
          if (sequence > 0 && config.delayMs > 0) await sleep(config.delayMs);
          if (run.stopped) break;
          const result = await this.#send(run, config.collectionId, itemId, iteration, sequence++, data);
          if (result) this.#emit({ type: "item", runId: run.id, result });
        }
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      this.#active = null;
      this.#emit({ type: "finished", runId: run.id, stopped: run.stopped, error });
    }
  }

  async #send(run: ActiveRun, collectionId: string, itemId: string, iteration: number, sequence: number, data: DataRow | null): Promise<RunItemResult | null> {
    const ws = this.workspaces.workspace;
    if (!ws) throw new Error("Se cerró la carpeta de trabajo");
    const source = { collectionId, itemId };
    let view;
    try {
      view = ws.getItem(source);
    } catch {
      return null; // Removed while the run was going: skip it.
    }
    const requestId = `run-${randomUUID()}`;
    run.currentRequestId = requestId;
    const startedAt = Date.now();
    const outcome = await this.engine.call(
      "http.send",
      { requestId, request: view.request, source, context: this.workspaces.contextFor(source), iterationData: data },
      view.request.settings.timeoutMs + HTTP_CALL_SLACK_MS,
    );
    run.currentRequestId = null;

    const base = {
      iteration: iteration + 1,
      sequence,
      itemId,
      name: view.name,
      path: view.path,
      method: view.request.method.toUpperCase(),
      url: view.request.url,
    };
    if (!outcome.ok) {
      return { ...base, status: null, statusText: null, error: outcome.error.code, message: outcome.error.message, durationMs: Date.now() - startedAt, sizeBytes: 0, tests: [], errors: [], console: [] };
    }
    const value = outcome.value;
    if (value.session) this.workspaces.applySession(value.session, collectionId);
    const scripts = value.kind === "cancelled" ? undefined : value.scripts;
    const report = { tests: scripts?.tests ?? [], errors: scripts?.errors ?? [], console: scripts?.console ?? [] };
    if (value.kind === "response") {
      const r = value.response;
      return { ...base, url: r.sent.url, status: r.status, statusText: r.statusText, error: null, message: null, durationMs: Math.round(r.timings.total), sizeBytes: r.sizes.body, ...report };
    }
    if (value.kind === "cancelled") return { ...base, status: null, statusText: null, error: "CANCELLED", message: null, durationMs: value.elapsedMs, sizeBytes: 0, ...report };
    return { ...base, status: null, statusText: null, error: value.code, message: value.message, durationMs: value.elapsedMs, sizeBytes: 0, ...report };
  }
}

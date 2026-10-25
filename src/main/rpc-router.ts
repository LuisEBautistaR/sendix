import { app, BrowserWindow, ipcMain } from "electron";
import { ErrorCodes, type Outcome } from "@shared/rpc";
import { isMethodName, methods, type MethodParams } from "@shared/methods";
import { IpcChannels, type AppInfo, type HistoryEntry } from "@shared/ipc";
import type { EngineHost } from "./engine-host";
import type { HistoryStore } from "./history";
import type { WorkspaceController } from "./workspace/controller";
import { isTrustedSender } from "./security";
import type { RealtimeRelay } from "./realtime";
import type { GrpcFiles } from "./grpc-files";

const forbidden: Outcome<never> = { ok: false, error: { code: ErrorCodes.forbidden, message: "Untrusted sender" } };
/** Slack on top of a request's own timeout before main gives up on the engine. */
const HTTP_CALL_SLACK_MS = 10_000;

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/** The renderer's only door to the engine and to stored data: checks the sender, the method and its params. */
export function registerRpcRouter(engine: EngineHost, history: HistoryStore, workspaces: WorkspaceController, realtime: RealtimeRelay, grpcFiles: GrpcFiles, testMode: boolean): void {
  ipcMain.handle(IpcChannels.engineCall, async (event, method: unknown, params: unknown): Promise<Outcome<unknown>> => {
    if (!isTrustedSender(event.senderFrame)) return forbidden;
    if (!isMethodName(method) || (methods[method].testOnly && !testMode)) {
      return { ok: false, error: { code: ErrorCodes.unknownMethod, message: `Unknown method "${String(method)}"` } };
    }
    const parsed = methods[method].params.safeParse(params);
    if (!parsed.success) {
      return { ok: false, error: { code: ErrorCodes.invalidParams, message: parsed.error.message } };
    }

    if (method === "import.openapi") {
      return { ok: false, error: { code: ErrorCodes.forbidden, message: "Imports go through the workspace" } };
    }
    if (method === "http.send") {
      const params = parsed.data as MethodParams<"http.send">;
      const { request } = params;
      // Inherited auth, collection variables and the active environment come from main only.
      const context = workspaces.contextFor(params.source ?? null);
      const outcome = await engine.call("http.send", { ...params, context }, request.settings.timeoutMs + HTTP_CALL_SLACK_MS);
      if (outcome.ok && outcome.value.session) {
        // Values scripts set stay in main: the renderer only sees the variables view.
        workspaces.applySession(outcome.value.session, params.source?.collectionId ?? null);
        delete outcome.value.session;
      }
      if (outcome.ok) {
        try {
          broadcast(IpcChannels.historyChanged, history.add(request, outcome.value));
        } catch (err) {
          console.error("[main] Could not save history entry", err);
        }
      }
      return outcome;
    }
    if (method === "realtime.connect") {
      const params = parsed.data as MethodParams<"realtime.connect">;
      const outcome = await engine.call("realtime.connect", { ...params, context: workspaces.contextFor(params.source ?? null) }, params.request.settings.timeoutMs + HTTP_CALL_SLACK_MS);
      if (outcome.ok && outcome.value.kind === "open") realtime.opened(params.connId);
      return outcome;
    }
    if (method === "realtime.send") {
      // Variables are resolved with the values of this moment, including those scripts set.
      const params = parsed.data as MethodParams<"realtime.send">;
      return engine.call("realtime.send", { ...params, context: workspaces.contextFor(params.source ?? null) });
    }
    if (method === "grpc.describe" || method === "grpc.start") {
      const params = parsed.data as MethodParams<"grpc.start">;
      const blocked = grpcFiles.forbiddenPath(params.request);
      if (blocked) return { ok: false, error: { code: ErrorCodes.forbidden, message: `Vuelve a elegir «${blocked}» con su botón: Sendix solo lee archivos que eliges tú o que usa una llamada guardada.` } };
      const context = workspaces.contextFor(params.source ?? null);
      if (method === "grpc.describe") return engine.call("grpc.describe", { request: params.request, context });
      const outcome = await engine.call("grpc.start", { ...params, context });
      if (outcome.ok && outcome.value.kind === "started") realtime.callStarted(params.callId);
      return outcome;
    }
    if (method === "grpc.send") {
      const params = parsed.data as MethodParams<"grpc.send">;
      return engine.call("grpc.send", { ...params, context: workspaces.contextFor(params.source ?? null) });
    }
    return engine.call(method, parsed.data as never);
  });

  ipcMain.handle(IpcChannels.engineStatus, (event) => (isTrustedSender(event.senderFrame) ? engine.status : null));

  ipcMain.handle(IpcChannels.historyList, (event): HistoryEntry[] | null => (isTrustedSender(event.senderFrame) ? history.list() : null));

  ipcMain.handle(IpcChannels.historyClear, (event): boolean => {
    if (!isTrustedSender(event.senderFrame)) return false;
    history.clear();
    broadcast(IpcChannels.historyChanged, null);
    return true;
  });

  ipcMain.handle(IpcChannels.appInfo, (event): AppInfo | null => {
    if (!isTrustedSender(event.senderFrame)) return null;
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    };
  });

  engine.on("status", (status) => broadcast(IpcChannels.engineStatusChanged, status));
}

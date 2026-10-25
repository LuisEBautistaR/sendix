/**
 * Runs sandboxed with context isolation: the page cannot reach ipcRenderer or
 * Node, only the named functions below. Arguments are validated again in main.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannels, type EngineStatus, type HistoryEntry, type UpdateState } from "@shared/ipc";
import type { SendixApi } from "./api";
import type { WorkspaceSnapshot } from "@shared/workspace";
import type { RunEvent } from "@shared/runner";
import type { RealtimeEvent } from "@shared/realtime";
import type { GrpcEvent } from "@shared/grpc";

const api: SendixApi = {
  engine: {
    call: (method, params) => ipcRenderer.invoke(IpcChannels.engineCall, method, params),
    status: () => ipcRenderer.invoke(IpcChannels.engineStatus),
    onStatus: (listener) => {
      const handler = (_event: IpcRendererEvent, status: EngineStatus) => listener(status);
      ipcRenderer.on(IpcChannels.engineStatusChanged, handler);
      return () => ipcRenderer.removeListener(IpcChannels.engineStatusChanged, handler);
    },
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo),
    updates: () => ipcRenderer.invoke(IpcChannels.updatesGet),
    checkUpdates: () => ipcRenderer.invoke(IpcChannels.updatesCheck),
    installUpdate: () => ipcRenderer.invoke(IpcChannels.updatesInstall),
    onUpdates: (listener) => {
      const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on(IpcChannels.updatesChanged, handler);
      return () => ipcRenderer.removeListener(IpcChannels.updatesChanged, handler);
    },
  },
  history: {
    list: () => ipcRenderer.invoke(IpcChannels.historyList),
    clear: () => ipcRenderer.invoke(IpcChannels.historyClear),
    onChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, entry: HistoryEntry | null) => listener(entry);
      ipcRenderer.on(IpcChannels.historyChanged, handler);
      return () => ipcRenderer.removeListener(IpcChannels.historyChanged, handler);
    },
  },
  workspace: {
    call: (op, args) => ipcRenderer.invoke(IpcChannels.workspaceOp, op, args),
    onChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, snapshot: WorkspaceSnapshot | null) => listener(snapshot);
      ipcRenderer.on(IpcChannels.workspaceChanged, handler);
      return () => ipcRenderer.removeListener(IpcChannels.workspaceChanged, handler);
    },
  },
  runner: {
    start: (config) => ipcRenderer.invoke(IpcChannels.runnerStart, config),
    stop: (runId) => ipcRenderer.invoke(IpcChannels.runnerStop, runId),
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, event: RunEvent) => listener(event);
      ipcRenderer.on(IpcChannels.runnerEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannels.runnerEvent, handler);
    },
  },
  realtime: {
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, event: RealtimeEvent) => listener(event);
      ipcRenderer.on(IpcChannels.realtimeEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannels.realtimeEvent, handler);
    },
  },
  grpc: {
    pick: (kind) => ipcRenderer.invoke(IpcChannels.grpcPick, kind),
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, event: GrpcEvent) => listener(event);
      ipcRenderer.on(IpcChannels.grpcEvent, handler);
      return () => ipcRenderer.removeListener(IpcChannels.grpcEvent, handler);
    },
  },
};

contextBridge.exposeInMainWorld("sendix", api);

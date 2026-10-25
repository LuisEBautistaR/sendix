import type { Outcome } from "../shared/rpc";
import type { MethodName, MethodParams, MethodResult } from "../shared/methods";
import type { AppInfo, EngineStatus, HistoryEntry, UpdateState } from "../shared/ipc";
import type { WorkspaceArgs, WorkspaceOp, WorkspaceResults } from "../shared/workspace-ops";
import type { WorkspaceSnapshot } from "../shared/workspace";
import type { RunConfig, RunEvent } from "../shared/runner";
import type { RealtimeEvent } from "../shared/realtime";
import type { GrpcEvent } from "../shared/grpc";

/** What the preload exposes to the renderer as window.sendix. Nothing else crosses the bridge. */
export interface SendixApi {
  engine: {
    call<M extends MethodName>(method: M, params: MethodParams<M>): Promise<Outcome<MethodResult<M>>>;
    status(): Promise<EngineStatus | null>;
    onStatus(listener: (status: EngineStatus) => void): () => void;
  };
  app: {
    info(): Promise<AppInfo | null>;
    updates(): Promise<UpdateState | null>;
    checkUpdates(): Promise<UpdateState | null>;
    /** Restarts into the downloaded version; does nothing until one is ready. */
    installUpdate(): Promise<void>;
    onUpdates(listener: (state: UpdateState) => void): () => void;
  };
  history: {
    list(): Promise<HistoryEntry[] | null>;
    clear(): Promise<boolean>;
    /** Called with the new entry, or null when the history was cleared. */
    onChanged(listener: (entry: HistoryEntry | null) => void): () => void;
  };
  workspace: {
    call<O extends WorkspaceOp>(op: O, args: WorkspaceArgs<O>): Promise<Outcome<WorkspaceResults[O]>>;
    /** Called with a fresh snapshot after every change, or null when the workspace is closed. */
    onChanged(listener: (snapshot: WorkspaceSnapshot | null) => void): () => void;
  };
  runner: {
    start(config: RunConfig): Promise<Outcome<{ runId: string }>>;
    stop(runId: string): Promise<boolean>;
    onEvent(listener: (event: RunEvent) => void): () => void;
  };
  realtime: {
    /** WebSocket and Socket.IO events; connect, send and close go through engine.call. */
    onEvent(listener: (event: RealtimeEvent) => void): () => void;
  };
  grpc: {
    /** Opens a file or folder picker in main; only picked paths may be read by the engine. */
    pick(kind: "proto" | "importPath" | "ca" | "cert" | "key"): Promise<string[]>;
    /** Response headers, messages and the final status of gRPC calls; calls go through engine.call. */
    onEvent(listener: (event: GrpcEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    sendix: SendixApi;
  }
}

import type { Outcome } from "../shared/rpc";
import type { MethodName, MethodParams, MethodResult } from "../shared/methods";
import type { AppInfo, EngineStatus, HistoryEntry, UpdateState } from "../shared/ipc";
import type { WorkspaceArgs, WorkspaceOp, WorkspaceResults } from "../shared/workspace-ops";
import type { WorkspaceSnapshot } from "../shared/workspace";
import type { RunConfig, RunEvent, RunRecord, RunSummary } from "../shared/runner";
import type { RealtimeEvent } from "../shared/realtime";
import type { GrpcEvent } from "../shared/grpc";
import type { Prefs } from "../shared/prefs";
import type { LinkedRequest } from "../shared/links";
import type { CurlBuild, CurlBuildResult } from "../shared/curl-export";

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
    /** Hands an HTML body to main and returns the URL of its sandboxed preview, or null if refused. */
    preview(html: string): Promise<string | null>;
    onUpdates(listener: (state: UpdateState) => void): () => void;
  };
  prefs: {
    get(): Promise<Prefs | null>;
    /** Saves the whole set; resolves to what was stored, or null if main rejected it. */
    set(prefs: Prefs): Promise<Prefs | null>;
    /** Opens the profile folder in the file explorer. */
    revealProfile(): Promise<void>;
    /** File dialog in main for network files; only paths picked this way can be saved in Settings. */
    pickFile(kind: "ca" | "cert" | "key" | "pfx"): Promise<string | null>;
    /** Stores (or with null, forgets) the proxy password ("proxy") or a certificate passphrase ("cert:<id>"), encrypted. */
    setSecret(name: string, value: string | null): Promise<boolean>;
    /** Which of those secrets are saved; their values never reach the page. */
    secrets(): Promise<{ proxyPassword: boolean; certPassphrases: string[] } | null>;
    onChanged(listener: (prefs: Prefs) => void): () => void;
  };
  links: {
    /** sendix:// links that arrived before the window listened (e.g. the one that started the app). */
    pending(): Promise<Array<{ id: string; request: LinkedRequest }> | null>;
    /** Takes a link off the waiting list (the user answered); null if it was not waiting. */
    decide(id: string): Promise<{ id: string; request: LinkedRequest } | null>;
    onRequest(listener: (link: { id: string; request: LinkedRequest }) => void): () => void;
  };
  curl: {
    /**
     * «Copiar como cURL»: main builds the command (inherited auth, variables, secrets).
     * The answer always hides secrets; with copy, main writes the command to the clipboard.
     */
    build(args: CurlBuild): Promise<CurlBuildResult>;
  };
  mockix: {
    /** Whether Mockix registered mockix:// on this machine. */
    available(): Promise<boolean>;
    /** Asks Mockix to import the collection's v2.1 file; Mockix confirms with the user. */
    importCollection(collectionId: string): Promise<{ ok: true } | { ok: false; message: string }>;
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
    /** Past runs of a collection, newest first. */
    history(collectionId: string): Promise<RunSummary[] | null>;
    record(id: number): Promise<RunRecord | null>;
    deleteRecord(id: number): Promise<boolean>;
    /** Asks where to save and writes the run as JSON. */
    exportRecord(id: number): Promise<"saved" | "cancelled" | "missing">;
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

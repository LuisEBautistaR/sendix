import type { HttpRequest } from "./http";

/** Channels between the renderer (through the preload bridge) and main. */
export const IpcChannels = {
  engineCall: "sendix:engine-call",
  engineStatus: "sendix:engine-status",
  engineStatusChanged: "sendix:engine-status-changed",
  appInfo: "sendix:app-info",
  historyList: "sendix:history-list",
  historyClear: "sendix:history-clear",
  historyChanged: "sendix:history-changed",
  workspaceOp: "sendix:workspace-op",
  workspaceChanged: "sendix:workspace-changed",
  runnerStart: "sendix:runner-start",
  runnerStop: "sendix:runner-stop",
  runnerEvent: "sendix:runner-event",
  realtimeEvent: "sendix:realtime-event",
  grpcEvent: "sendix:grpc-event",
  grpcPick: "sendix:grpc-pick",
  updatesGet: "sendix:updates-get",
  updatesCheck: "sendix:updates-check",
  updatesInstall: "sendix:updates-install",
  updatesChanged: "sendix:updates-changed",
  prefsGet: "sendix:prefs-get",
  prefsSet: "sendix:prefs-set",
  prefsChanged: "sendix:prefs-changed",
  profileReveal: "sendix:profile-reveal",
  prefsPick: "sendix:prefs-pick",
  prefsSecret: "sendix:prefs-secret",
  prefsSecrets: "sendix:prefs-secrets",
  previewPut: "sendix:preview-put",
  runsList: "sendix:runs-list",
  runsGet: "sendix:runs-get",
  runsDelete: "sendix:runs-delete",
  runsExport: "sendix:runs-export",
  linksPending: "sendix:links-pending",
  linkDecide: "sendix:link-decide",
  linkRequest: "sendix:link-request",
  mockixAvailable: "sendix:mockix-available",
  mockixImport: "sendix:mockix-import",
  curlBuild: "sendix:curl-build",
} as const;

export interface UpdateState {
  /** disabled: development builds never update. */
  status: "disabled" | "idle" | "checking" | "current" | "downloading" | "ready" | "error";
  version: string | null;
  percent: number | null;
  message: string | null;
  checkedAt: number | null;
}

export interface HistoryEntry {
  id: number;
  at: number;
  method: string;
  url: string;
  status: number | null;
  statusText: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  /** Error code when there was no response (e.g. ECONNREFUSED, CANCELLED). */
  error: string | null;
  /** True when credentials were blanked before saving. */
  redacted: boolean;
  request: HttpRequest;
}

export type EngineState = "starting" | "ready" | "restarting" | "failed" | "stopped";

export interface EngineStatus {
  state: EngineState;
  pid: number | null;
  /** How many times main has restarted the engine since the app started. */
  restarts: number;
  /** When the current engine process became ready (epoch ms). */
  readySince: number | null;
  lastExit: { code: number; at: number } | null;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  packaged: boolean;
  /** Profile folder: settings, history and encrypted secrets. */
  userData: string;
}

import { create } from "zustand";
import { DEFAULT_SETTINGS, type HttpOutcome, type HttpRequest, type KeyValue, type RequestSource } from "@shared/http";
import type { RpcError } from "@shared/rpc";
import type { VariableView, WorkspaceSnapshot } from "@shared/workspace";
import type { TreeNode } from "@shared/collection";
import type { WorkspaceArgs, WorkspaceOp, WorkspaceResults } from "@shared/workspace-ops";
import { DEFAULT_RUN_OPTIONS, resultFailed, type RunEvent, type RunItemResult, type RunOptions, type RunSummary } from "@shared/runner";
import { emptyGrpc, type CallType, type GrpcEvent, type GrpcRequest, type GrpcServiceInfo } from "@shared/grpc";
import { emptyRealtime, realtimeUrl, type HandshakeInfo, type OutgoingMessage, type RealtimeEvent, type RealtimeMessage, type RealtimeProtocol, type RealtimeRequest } from "@shared/realtime";
import type { DataFile } from "@shared/data-file";
import { DEFAULT_PREFS, type Prefs } from "@shared/prefs";
import { buildUrl, paramsFromUrl, splitUrl, withScheme } from "../lib/url";

export type RequestPanel = "params" | "auth" | "headers" | "body" | "scripts" | "settings";
export type ResponsePanel = "body" | "headers" | "cookies" | "tests" | "console" | "timeline";
export type ScriptPhase = "prerequest" | "test";
export type BodyView = "pretty" | "raw" | "preview";
/** How to read the response body: detected from Content-Type and content, or forced. */
export type BodyFormat = "auto" | "json" | "xml" | "html" | "text";

export interface RequestTab {
  id: string;
  kind: "request";
  draft: HttpRequest;
  /** Full parameter table, including unchecked rows that are not in the URL. */
  params: KeyValue[];
  /** The saved request this tab edits, or null for a scratch request. */
  source: RequestSource | null;
  /** Saved name and folder trail (null for scratch requests). */
  name: string | null;
  path: string[];
  /** What was last loaded or saved, to tell whether there are unsaved changes. */
  saved: string | null;
  /** Opened from history with credentials blanked. */
  redactedFromHistory: boolean;
  /** Things a cURL paste could not carry over. */
  notes: string[];
  status: "idle" | "sending";
  requestId: string | null;
  outcome: HttpOutcome | null;
  /** Transport failure between UI and engine (not an HTTP error). */
  rpcError: RpcError | null;
  sentAt: number | null;
  /** Settings used for the last send, to explain timeouts. */
  lastTimeoutMs: number | null;
  panel: RequestPanel;
  scriptPhase: ScriptPhase;
  responsePanel: ResponsePanel;
  bodyView: BodyView;
  bodyFormat: BodyFormat;
  /** JSONPath (JSON) or XPath (XML) applied to the formatted body; empty for none. */
  bodyFilter: string;
}

export interface SystemTab {
  id: string;
  kind: "system";
}

export interface SettingsTab {
  id: string;
  kind: "settings";
}

export interface EnvironmentTab {
  id: string;
  kind: "environment";
  environmentId: string;
}

export interface RunnerTab {
  id: string;
  kind: "runner";
  collectionId: string;
  /** null runs the whole collection. */
  folderId: string | null;
  iterations: number;
  delayMs: number;
  data: (DataFile & { name: string }) | null;
  /** Request ids in the order chosen by the user; null keeps the collection order. */
  order: string[] | null;
  /** Requests left out of the run. */
  excluded: string[];
  options: RunOptions;
  status: "idle" | "running" | "stopping";
  runId: string | null;
  /** Requests per iteration and iterations of the current or last run. */
  plan: { requests: number; iterations: number } | null;
  results: RunItemResult[];
  startedAt: number | null;
  finishedAt: number | null;
  finish: { stopped: boolean; error: string | null; stoppedOnError: boolean; persisted: number | null; recordId: number | null } | null;
  /** Past runs of this collection (null until loaded). */
  history: RunSummary[] | null;
  /** The results on screen come from the run history, not from a run just made. */
  fromHistory: boolean;
  onlyFailures: boolean;
  /** Sequence of the result row shown expanded. */
  expanded: number | null;
}

export type RealtimePanel = "message" | "headers" | "settings";

/** One line of a connection log. */
export interface LogEntry {
  seq: number;
  kind: "message" | "info" | "open" | "error" | "closed";
  at: number;
  message?: RealtimeMessage;
  text?: string;
}

export interface ConnectionRecord {
  start: number;
  end: number;
  code: number | null;
  reason: string;
  messages: number;
}

export interface RealtimeTab {
  id: string;
  kind: "realtime";
  draft: RealtimeRequest;
  source: RequestSource | null;
  name: string | null;
  path: string[];
  saved: string | null;
  connId: string | null;
  state: "idle" | "connecting" | "open" | "closing";
  openedAt: number | null;
  handshake: HandshakeInfo | null;
  /** Why the last connect attempt failed. */
  failure: { code: string; message: string; status: number | null } | null;
  log: LogEntry[];
  /** Messages of the current connection, for the connections table. */
  messageCount: number;
  connections: ConnectionRecord[];
  composer: OutgoingMessage;
  panel: RealtimePanel;
  filter: "all" | "out" | "in";
  search: string;
  selected: number | null;
}

export type GrpcPanel = "message" | "metadata" | "definition" | "settings";

export interface GrpcLogEntry {
  seq: number;
  dir: "in" | "out";
  at: number;
  text: string;
  size: number;
  truncated: boolean;
}

export interface GrpcTab {
  id: string;
  kind: "grpc";
  draft: GrpcRequest;
  source: RequestSource | null;
  name: string | null;
  path: string[];
  saved: string | null;
  /** Services from the last describe; null until loaded. */
  services: GrpcServiceInfo[] | null;
  describing: boolean;
  describeError: { code: string; message: string } | null;
  callId: string | null;
  callType: CallType | null;
  state: "idle" | "starting" | "running";
  /** Client and bidirectional streams: the request side was closed. */
  halfClosed: boolean;
  startedAt: number | null;
  log: GrpcLogEntry[];
  headers: Array<{ key: string; value: string }>;
  status: Extract<GrpcEvent, { type: "status" }> | null;
  startError: { code: string; message: string } | null;
  panel: GrpcPanel;
  responsePanel: "response" | "metadata";
  selected: number | null;
}

export type Tab = RequestTab | SystemTab | SettingsTab | EnvironmentTab | RunnerTab | RealtimeTab | GrpcTab;
export type EditableTab = RequestTab | RealtimeTab | GrpcTab;
const MAX_LOG = 5_000;

export { resultFailed };
const MAX_RESULTS = 20_000;
export type SidebarView = "collections" | "environments" | "history";

export interface Notice {
  id: number;
  tone: "ok" | "err";
  text: string;
}

/** Request ids a runner tab can run, in collection order. */
export function runnableIds(workspace: WorkspaceSnapshot | null, tab: Pick<RunnerTab, "collectionId" | "folderId">): string[] {
  const collection = workspace?.collections.find((c) => c.id === tab.collectionId);
  if (!collection) return [];
  const walk = (nodes: readonly TreeNode[]): TreeNode | null => {
    for (const n of nodes) {
      if (n.id === tab.folderId) return n;
      const found = walk(n.children ?? []);
      if (found) return found;
    }
    return null;
  };
  const ids = (nodes: readonly TreeNode[]): string[] => nodes.flatMap((n) => (n.kind === "request" ? [n.id] : ids(n.children ?? [])));
  const root = tab.folderId ? walk(collection.tree) : null;
  return ids(root ? (root.children ?? []) : collection.tree);
}

/** Last preferences heard from main; new requests take their timeout from here. */
let prefsNow: Prefs = DEFAULT_PREFS;

export function emptyRequest(): HttpRequest {
  return { method: "GET", url: "", headers: [], body: { mode: "none" }, auth: { type: "none" }, settings: { ...DEFAULT_SETTINGS, timeoutMs: prefsNow.request.timeoutMs } };
}

/** Saved requests do not store a timeout: they open with the one from Settings. */
const withTimeout = (request: HttpRequest): HttpRequest => ({ ...request, settings: { ...request.settings, timeoutMs: prefsNow.request.timeoutMs } });
const isUntouchedScratch = (t: Tab): t is RequestTab => t.kind === "request" && !t.source && t.draft.url === "" && !t.outcome && t.status !== "sending";

const fingerprint = (draft: HttpRequest, params: KeyValue[]) => JSON.stringify([draft, params.filter((p) => !p.enabled)]);
const realtimeFingerprint = (draft: RealtimeRequest) => JSON.stringify(draft);
const grpcFingerprint = (draft: GrpcRequest) => JSON.stringify(draft);
export const isDirty = (tab: EditableTab) =>
  tab.saved !== null &&
  tab.saved !== (tab.kind === "realtime" ? realtimeFingerprint(tab.draft) : tab.kind === "grpc" ? grpcFingerprint(tab.draft) : fingerprint(tab.draft, tab.params));

let tabSeq = 0;
function requestTab(draft: HttpRequest = emptyRequest(), extra: Partial<RequestTab> = {}): RequestTab {
  return {
    id: `tab-${++tabSeq}`,
    kind: "request",
    draft,
    params: splitUrl(draft.url).query,
    source: null,
    name: null,
    path: [],
    saved: null,
    redactedFromHistory: false,
    notes: [],
    status: "idle",
    requestId: null,
    outcome: null,
    rpcError: null,
    sentAt: null,
    lastTimeoutMs: null,
    panel: "params",
    scriptPhase: "prerequest",
    responsePanel: "body",
    bodyView: "pretty",
    bodyFormat: "auto",
    bodyFilter: "",
    ...extra,
  };
}

function realtimeTab(draft: RealtimeRequest, extra: Partial<RealtimeTab> = {}): RealtimeTab {
  return {
    id: `tab-${++tabSeq}`,
    kind: "realtime",
    draft,
    source: null,
    name: null,
    path: [],
    saved: null,
    connId: null,
    state: "idle",
    openedAt: null,
    handshake: null,
    failure: null,
    log: [],
    messageCount: 0,
    connections: [],
    composer: { body: "", language: "json", event: "", ack: false },
    panel: "message",
    filter: "all",
    search: "",
    selected: null,
    ...extra,
  };
}

function grpcTab(draft: GrpcRequest, extra: Partial<GrpcTab> = {}): GrpcTab {
  return {
    id: `tab-${++tabSeq}`,
    kind: "grpc",
    draft,
    source: null,
    name: null,
    path: [],
    saved: null,
    services: null,
    describing: false,
    describeError: null,
    callId: null,
    callType: null,
    state: "idle",
    halfClosed: false,
    startedAt: null,
    log: [],
    headers: [],
    status: null,
    startError: null,
    panel: "message",
    responsePanel: "response",
    selected: null,
    ...extra,
  };
}

let logSeq = 0;

export class OpError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Calls a workspace operation in main; failures become OpError. */
export async function ws<O extends WorkspaceOp>(op: O, args: WorkspaceArgs<O>): Promise<WorkspaceResults[O]> {
  const outcome = await window.sendix.workspace.call(op, args);
  if (!outcome.ok) throw new OpError(outcome.error.code, outcome.error.message);
  return outcome.value;
}

interface State {
  tabs: Tab[];
  activeId: string;
  sidebar: SidebarView;
  workspace: WorkspaceSnapshot | null;
  /** Variables available to the active tab (secrets without values). */
  variables: VariableView[];
  notices: Notice[];
  /** Tab waiting for the "save as" dialog. */
  savingTabId: string | null;
  prefs: Prefs;

  newRequest(draft?: HttpRequest, extra?: Partial<RequestTab>): void;
  openItem(source: RequestSource): Promise<void>;
  openEnvironment(environmentId: string): void;
  openSystem(): void;
  openSettings(): void;
  /** Applies preferences main announced (startup or after a change). */
  setPrefs(prefs: Prefs): void;
  /** Saves new preferences through main; the change comes back through setPrefs. */
  savePrefs(update: (prefs: Prefs) => Prefs): Promise<void>;
  openRunner(collectionId: string, folderId: string | null): void;
  /** Turns a scratch tab into a WebSocket/Socket.IO tab or back into HTTP (method). */
  switchProtocol(id: string, target: RealtimeProtocol | string): void;
  patchRealtime(id: string, patch: Partial<Omit<RealtimeTab, "id" | "kind">>): void;
  setRealtimeDraft(id: string, update: (draft: RealtimeRequest) => RealtimeRequest): void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  sendMessage(id: string): Promise<void>;
  onRealtimeEvent(event: RealtimeEvent): void;
  patchGrpc(id: string, patch: Partial<Omit<GrpcTab, "id" | "kind">>): void;
  setGrpcDraft(id: string, update: (draft: GrpcRequest) => GrpcRequest): void;
  describeGrpc(id: string): Promise<void>;
  invokeGrpc(id: string): Promise<void>;
  sendGrpc(id: string): Promise<void>;
  endGrpc(id: string): Promise<void>;
  cancelGrpc(id: string): Promise<void>;
  onGrpcEvent(event: GrpcEvent): void;
  pickGrpcFiles(id: string, kind: "proto" | "importPath" | "ca" | "cert" | "key"): Promise<void>;
  patchRunner(id: string, patch: Partial<Omit<RunnerTab, "id" | "kind">>): void;
  startRun(id: string): Promise<void>;
  stopRun(id: string): Promise<void>;
  loadRunHistory(id: string): Promise<void>;
  /** Shows a past run's results in the runner tab. */
  openRunRecord(id: string, recordId: number): Promise<void>;
  /** Loads a past run's settings into the tab and runs it again. */
  repeatRun(id: string, recordId: number): Promise<void>;
  deleteRunRecord(id: string, recordId: number): Promise<void>;
  exportRunRecord(recordId: number): Promise<void>;
  /** Back from the results to the run settings. */
  backToPlan(id: string): void;
  onRunEvent(event: RunEvent): void;
  close(id: string): void;
  activate(id: string): void;
  setSidebar(view: SidebarView): void;
  setWorkspace(snapshot: WorkspaceSnapshot | null): void;
  refreshVariables(): Promise<void>;
  notify(tone: Notice["tone"], text: string): void;
  dismiss(id: number): void;
  /** Patch a request tab (draft edits go through setDraft so URL and params stay in sync). */
  patch(id: string, patch: Partial<Omit<RequestTab, "id" | "kind" | "draft" | "params">>): void;
  setDraft(id: string, update: (draft: HttpRequest) => HttpRequest): void;
  replaceDraft(id: string, draft: HttpRequest, notes?: string[]): void;
  setUrl(id: string, url: string): void;
  setParams(id: string, params: KeyValue[]): void;
  send(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Saves to its collection, or opens the "save as" dialog for scratch requests. */
  save(id: string): Promise<void>;
  saveAs(id: string, collectionId: string, parentId: string | null, name: string): Promise<void>;
  closeSaveDialog(): void;
}

const first = requestTab();
let noticeSeq = 0;

export const useStore = create<State>((set, get) => {
  const mapRequest = (id: string, fn: (tab: RequestTab) => RequestTab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === "request" ? fn(t) : t)) }));
  const find = (id: string) => get().tabs.find((t): t is RequestTab => t.id === id && t.kind === "request");
  const fail = (err: unknown) => get().notify("err", err instanceof Error ? err.message : String(err));
  const findRealtime = (id: string) => get().tabs.find((t): t is RealtimeTab => t.id === id && t.kind === "realtime");
  const mapRealtime = (match: (t: RealtimeTab) => boolean, fn: (tab: RealtimeTab) => RealtimeTab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.kind === "realtime" && match(t) ? fn(t) : t)) }));
  const findGrpc = (id: string) => get().tabs.find((t): t is GrpcTab => t.id === id && t.kind === "grpc");
  const mapGrpc = (match: (t: GrpcTab) => boolean, fn: (tab: GrpcTab) => GrpcTab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.kind === "grpc" && match(t) ? fn(t) : t)) }));
  const appendLog = (tab: RealtimeTab, entry: Omit<LogEntry, "seq">): LogEntry[] => {
    const log = [...tab.log, { ...entry, seq: ++logSeq }];
    return log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log;
  };

  return {
    tabs: [first],
    activeId: first.id,
    sidebar: "collections",
    workspace: null,
    variables: [],
    notices: [],
    savingTabId: null,
    prefs: DEFAULT_PREFS,

    newRequest: (draft, extra = {}) => {
      const tab = requestTab(draft, extra);
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      void get().refreshVariables();
    },

    openItem: async (source) => {
      const open = get().tabs.find(
        (t) => (t.kind === "request" || t.kind === "realtime" || t.kind === "grpc") && t.source?.collectionId === source.collectionId && t.source.itemId === source.itemId,
      );
      if (open) {
        set({ activeId: open.id });
        void get().refreshVariables();
        return;
      }
      try {
        const view = await ws("getItem", source);
        const params = [...splitUrl(view.request.url).query, ...view.disabledParams];
        const tab: Tab = view.grpc
          ? grpcTab(view.grpc, { source, name: view.name, path: view.path, saved: grpcFingerprint(view.grpc) })
          : view.realtime
          ? realtimeTab(view.realtime, { source, name: view.name, path: view.path, saved: realtimeFingerprint(view.realtime) })
          : requestTab(withTimeout(view.request), {
              params,
              source,
              name: view.name,
              path: view.path,
              saved: fingerprint(withTimeout(view.request), params),
            });
        // Reuse an untouched empty scratch tab instead of piling up tabs.
        set((s) => {
          const active = s.tabs.find((t) => t.id === s.activeId);
          const reusable = active?.kind === "request" && !active.source && active.draft.url === "" && !active.outcome;
          const tabs = reusable ? s.tabs.map((t) => (t.id === active.id ? tab : t)) : [...s.tabs, tab];
          return { tabs, activeId: tab.id };
        });
        void get().refreshVariables();
      } catch (err) {
        fail(err);
      }
    },

    openEnvironment: (environmentId) => {
      const existing = get().tabs.find((t) => t.kind === "environment" && t.environmentId === environmentId);
      if (existing) return set({ activeId: existing.id });
      const tab: EnvironmentTab = { id: `tab-${++tabSeq}`, kind: "environment", environmentId };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    },

    openSettings: () => {
      const existing = get().tabs.find((t) => t.kind === "settings");
      if (existing) return set({ activeId: existing.id });
      const tab: SettingsTab = { id: `tab-${++tabSeq}`, kind: "settings" };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    },

    setPrefs: (prefs) => {
      const previous = prefsNow;
      prefsNow = prefs;
      document.documentElement.style.setProperty("--code-size", `${prefs.editor.fontSize}px`);
      set((s) => ({
        prefs,
        // Empty scratch tabs still carry the old default timeout: give them the new one.
        tabs:
          previous.request.timeoutMs === prefs.request.timeoutMs
            ? s.tabs
            : s.tabs.map((t) => (isUntouchedScratch(t) && t.draft.settings.timeoutMs === previous.request.timeoutMs ? { ...t, draft: { ...t.draft, settings: { ...t.draft.settings, timeoutMs: prefs.request.timeoutMs } } } : t)),
      }));
    },

    savePrefs: async (update) => {
      const before = get().prefs;
      // Shown at once; main stores it and answers with what it kept.
      get().setPrefs(update(before));
      const saved = await window.sendix.prefs.set(get().prefs);
      if (saved) return get().setPrefs(saved);
      get().setPrefs(before);
      get().notify("err", "No se pudieron guardar los ajustes.");
    },

    openSystem: () => {
      const existing = get().tabs.find((t) => t.kind === "system");
      if (existing) return set({ activeId: existing.id });
      const tab: SystemTab = { id: `tab-${++tabSeq}`, kind: "system" };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    },

    openRunner: (collectionId, folderId) => {
      const existing = get().tabs.find((t) => t.kind === "runner" && t.collectionId === collectionId && t.folderId === folderId);
      if (existing) return set({ activeId: existing.id });
      const tab: RunnerTab = {
        id: `tab-${++tabSeq}`,
        kind: "runner",
        collectionId,
        folderId,
        iterations: 1,
        delayMs: 0,
        data: null,
        order: null,
        excluded: [],
        options: { ...DEFAULT_RUN_OPTIONS },
        status: "idle",
        runId: null,
        plan: null,
        results: [],
        startedAt: null,
        finishedAt: null,
        finish: null,
        history: null,
        fromHistory: false,
        onlyFailures: false,
        expanded: null,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    },

    patchRunner: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === "runner" ? { ...t, ...patch } : t)) })),

    startRun: async (id) => {
      const tab = get().tabs.find((t): t is RunnerTab => t.id === id && t.kind === "runner");
      if (!tab || tab.status !== "idle") return;
      const excluded = new Set(tab.excluded);
      const itemIds = tab.order || excluded.size ? (tab.order ?? runnableIds(get().workspace, tab)).filter((i) => !excluded.has(i)) : null;
      if (itemIds && !itemIds.length) return get().notify("err", "Elige al menos una petición para ejecutar.");
      get().patchRunner(id, { status: "running", results: [], plan: null, finish: null, expanded: null, startedAt: Date.now(), finishedAt: null, fromHistory: false });
      const outcome = await window.sendix.runner.start({
        collectionId: tab.collectionId,
        folderId: tab.folderId,
        itemIds,
        iterations: tab.iterations,
        delayMs: tab.delayMs,
        data: tab.data?.rows ?? null,
        dataName: tab.data?.name ?? null,
        options: tab.options,
      });
      if (outcome.ok) get().patchRunner(id, { runId: outcome.value.runId });
      else {
        get().patchRunner(id, { status: "idle", startedAt: null });
        get().notify("err", outcome.error.message);
      }
    },

    stopRun: async (id) => {
      const tab = get().tabs.find((t): t is RunnerTab => t.id === id && t.kind === "runner");
      if (!tab?.runId || tab.status !== "running") return;
      get().patchRunner(id, { status: "stopping" });
      await window.sendix.runner.stop(tab.runId);
    },

    onRunEvent: (event) =>
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.kind !== "runner") return t;
          // "started" can arrive before start() resolves with the run id.
          if (event.type === "started") return t.status !== "idle" && (t.runId === null || t.runId === event.runId) ? { ...t, runId: event.runId, plan: { requests: event.requests, iterations: event.iterations } } : t;
          if (t.runId !== event.runId) return t;
          if (event.type === "item") return t.results.length >= MAX_RESULTS ? t : { ...t, results: [...t.results, event.result] };
          return {
            ...t,
            status: "idle",
            finishedAt: Date.now(),
            finish: { stopped: event.stopped, error: event.error, stoppedOnError: event.stoppedOnError, persisted: event.persisted, recordId: event.recordId },
            // The run history changed: reload it next time it is shown.
            history: null,
          };
        }),
      })),

    loadRunHistory: async (id) => {
      const tab = get().tabs.find((t): t is RunnerTab => t.id === id && t.kind === "runner");
      if (!tab) return;
      const history = await window.sendix.runner.history(tab.collectionId);
      get().patchRunner(id, { history: history ?? [] });
    },

    openRunRecord: async (id, recordId) => {
      const record = await window.sendix.runner.record(recordId);
      if (!record) return get().notify("err", "Esa ejecución ya no está en el historial.");
      get().patchRunner(id, {
        results: record.results,
        plan: { requests: record.requests, iterations: record.iterations },
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        finish: { stopped: record.state === "stopped", error: record.state === "error" ? "terminó con un error" : null, stoppedOnError: false, persisted: null, recordId: record.id },
        expanded: null,
        onlyFailures: false,
        fromHistory: true,
      });
    },

    repeatRun: async (id, recordId) => {
      const record = await window.sendix.runner.record(recordId);
      if (!record) return get().notify("err", "Esa ejecución ya no está en el historial.");
      const c = record.config;
      const data = c.data?.length ? { format: "json" as const, columns: [...new Set(c.data.flatMap((r) => Object.keys(r)))], rows: c.data, name: c.dataName ?? "datos" } : null;
      const tab = get().tabs.find((t): t is RunnerTab => t.id === id && t.kind === "runner");
      const all = tab ? runnableIds(get().workspace, tab) : [];
      const chosen = c.itemIds ?? all;
      get().patchRunner(id, {
        iterations: c.iterations,
        delayMs: c.delayMs,
        data,
        options: c.options,
        // Requests added since go at the end, left out.
        order: c.itemIds ? [...chosen, ...all.filter((i) => !chosen.includes(i))] : null,
        excluded: c.itemIds ? all.filter((i) => !chosen.includes(i)) : [],
      });
      if (c.dataName && !data) get().notify("err", `El archivo de datos «${c.dataName}» era demasiado grande para el historial: vuelve a elegirlo y ejecuta.`);
      else await get().startRun(id);
    },

    deleteRunRecord: async (id, recordId) => {
      await window.sendix.runner.deleteRecord(recordId);
      await get().loadRunHistory(id);
    },

    exportRunRecord: async (recordId) => {
      const result = await window.sendix.runner.exportRecord(recordId);
      if (result === "saved") get().notify("ok", "Ejecución exportada.");
      else if (result === "missing") get().notify("err", "Esa ejecución ya no está en el historial.");
    },

    backToPlan: (id) => get().patchRunner(id, { startedAt: null, finishedAt: null, results: [], plan: null, finish: null, expanded: null, fromHistory: false, history: null }),

    close: (id) => {
      const closing = get().tabs.find((t) => t.id === id);
      if (closing?.kind === "grpc") {
        if (isDirty(closing) && !window.confirm(`«${closing.name}» tiene cambios sin guardar. ¿Cerrar de todos modos?`)) return;
        if (closing.callId) void window.sendix.engine.call("grpc.cancel", { callId: closing.callId });
      }
      if (closing?.kind === "realtime") {
        if (isDirty(closing) && !window.confirm(`«${closing.name}» tiene cambios sin guardar. ¿Cerrar de todos modos?`)) return;
        if (closing.state !== "idle") void get().disconnect(id);
      }
      if (closing?.kind === "runner" && closing.status !== "idle") {
        if (!window.confirm("La ejecución sigue en curso. ¿Detenerla y cerrar?")) return;
        void get().stopRun(id);
      }
      const tab = find(id);
      if (tab && isDirty(tab) && !window.confirm(`«${tab.name}» tiene cambios sin guardar. ¿Cerrar de todos modos?`)) return;
      if (tab?.status === "sending") void get().cancel(id);
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        let tabs = s.tabs.filter((t) => t.id !== id);
        if (tabs.length === 0) tabs = [requestTab()];
        const activeId = s.activeId === id ? tabs[Math.min(index, tabs.length - 1)]!.id : s.activeId;
        return { tabs, activeId };
      });
      void get().refreshVariables();
    },

    activate: (id) => {
      set({ activeId: id });
      void get().refreshVariables();
    },
    setSidebar: (sidebar) => set({ sidebar }),

    setWorkspace: (snapshot) => {
      set((s) => {
        const known = new Set(snapshot?.collections.map((c) => c.id) ?? []);
        const envs = new Set(snapshot?.environments.map((e) => e.id) ?? []);
        // Tabs whose request or environment disappeared become scratch tabs or close.
        const tabs = s.tabs
          .filter((t) => t.kind !== "environment" || envs.has(t.environmentId))
          .filter((t) => t.kind !== "runner" || known.has(t.collectionId) || t.status !== "idle")
          .map((t) =>
            (t.kind === "request" || t.kind === "realtime" || t.kind === "grpc") && t.source && !known.has(t.source.collectionId) ? { ...t, source: null, name: null, path: [], saved: null } : t,
          );
        const activeId = tabs.some((t) => t.id === s.activeId) ? s.activeId : (tabs[0]?.id ?? s.activeId);
        return { workspace: snapshot, tabs: tabs.length ? tabs : [requestTab()], activeId };
      });
      void get().refreshVariables();
    },

    refreshVariables: async () => {
      const s = get();
      if (!s.workspace) return set({ variables: [] });
      const active = s.tabs.find((t) => t.id === s.activeId);
      const collectionId = active?.kind === "request" || active?.kind === "realtime" || active?.kind === "grpc" ? (active.source?.collectionId ?? null) : null;
      try {
        set({ variables: await ws("variables", { collectionId }) });
      } catch {
        set({ variables: [] });
      }
    },

    notify: (tone, text) => {
      const notice = { id: ++noticeSeq, tone, text };
      set((s) => ({ notices: [...s.notices.slice(-2), notice] }));
      setTimeout(() => get().dismiss(notice.id), tone === "err" ? 8000 : 4000);
    },
    dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

    patch: (id, patch) => mapRequest(id, (t) => ({ ...t, ...patch })),

    setDraft: (id, update) => mapRequest(id, (t) => ({ ...t, draft: update(t.draft) })),

    replaceDraft: (id, draft, notes = []) =>
      mapRequest(id, (t) => ({ ...t, draft, params: splitUrl(draft.url).query, notes, outcome: null, rpcError: null })),

    setUrl: (id, url) => mapRequest(id, (t) => ({ ...t, draft: { ...t.draft, url }, params: paramsFromUrl(url, t.params) })),

    setParams: (id, params) =>
      mapRequest(id, (t) => {
        const { base, hash } = splitUrl(t.draft.url);
        return { ...t, params, draft: { ...t.draft, url: buildUrl(base, params, hash) } };
      }),

    send: async (id) => {
      const tab = find(id);
      if (!tab || tab.status === "sending" || tab.draft.url.trim() === "") return;
      const requestId = crypto.randomUUID();
      const request = { ...tab.draft, url: withScheme(tab.draft.url) };
      mapRequest(id, (t) => ({ ...t, status: "sending", requestId, rpcError: null, sentAt: Date.now(), lastTimeoutMs: request.settings.timeoutMs }));
      const result = await window.sendix.engine.call("http.send", { requestId, request, source: tab.source });
      mapRequest(id, (t) =>
        t.requestId !== requestId
          ? t
          : result.ok
            ? { ...t, status: "idle", requestId: null, outcome: result.value }
            : { ...t, status: "idle", requestId: null, outcome: null, rpcError: result.error },
      );
    },

    cancel: async (id) => {
      const tab = find(id);
      if (!tab?.requestId) return;
      await window.sendix.engine.call("http.cancel", { requestId: tab.requestId });
    },

    save: async (id) => {
      const call = findGrpc(id);
      if (call) {
        if (!call.source) {
          if (!get().workspace) return get().notify("err", "Abre una carpeta de trabajo para guardar llamadas.");
          return set({ savingTabId: id });
        }
        try {
          await ws("saveGrpcItem", { source: call.source, grpc: call.draft });
          mapGrpc((t) => t.id === id, (t) => ({ ...t, saved: grpcFingerprint(call.draft) }));
        } catch (err) {
          fail(err);
        }
        return;
      }
      const live = findRealtime(id);
      if (live) {
        if (!live.source) {
          if (!get().workspace) return get().notify("err", "Abre una carpeta de trabajo para guardar conexiones.");
          return set({ savingTabId: id });
        }
        try {
          await ws("saveRealtimeItem", { source: live.source, realtime: live.draft });
          mapRealtime((t) => t.id === id, (t) => ({ ...t, saved: realtimeFingerprint(live.draft) }));
        } catch (err) {
          fail(err);
        }
        return;
      }
      const tab = find(id);
      if (!tab) return;
      if (!tab.source) {
        if (!get().workspace) return get().notify("err", "Abre una carpeta de trabajo para guardar peticiones.");
        return set({ savingTabId: id });
      }
      const disabledParams = tab.params.filter((p) => !p.enabled);
      try {
        await ws("saveItem", { source: tab.source, request: tab.draft, disabledParams });
        mapRequest(id, (t) => ({ ...t, saved: fingerprint(tab.draft, tab.params) }));
      } catch (err) {
        fail(err);
      }
    },

    saveAs: async (id, collectionId, parentId, name) => {
      const call = findGrpc(id);
      if (call) {
        try {
          const { itemId } = await ws("createGrpcRequest", { collectionId, parentId, name, grpc: call.draft });
          const view = await ws("getItem", { collectionId, itemId });
          mapGrpc((t) => t.id === id, (t) => ({ ...t, source: { collectionId, itemId }, name: view.name, path: view.path, saved: grpcFingerprint(call.draft) }));
          set({ savingTabId: null });
          get().notify("ok", `Guardada como «${name}».`);
          void get().refreshVariables();
        } catch (err) {
          fail(err);
        }
        return;
      }
      const live = findRealtime(id);
      if (live) {
        try {
          const { itemId } = await ws("createRealtimeRequest", { collectionId, parentId, name, realtime: live.draft });
          const view = await ws("getItem", { collectionId, itemId });
          mapRealtime(
            (t) => t.id === id,
            (t) => ({ ...t, source: { collectionId, itemId }, name: view.name, path: view.path, saved: realtimeFingerprint(live.draft) }),
          );
          set({ savingTabId: null });
          get().notify("ok", `Guardada como «${name}».`);
          void get().refreshVariables();
        } catch (err) {
          fail(err);
        }
        return;
      }
      const tab = find(id);
      if (!tab) return;
      const disabledParams = tab.params.filter((p) => !p.enabled);
      // A scratch request has explicit auth; inside a collection "none" stays explicit (noauth).
      try {
        const { itemId } = await ws("createRequest", { collectionId, parentId, name, request: tab.draft, disabledParams });
        const view = await ws("getItem", { collectionId, itemId });
        mapRequest(id, (t) => ({
          ...t,
          source: { collectionId, itemId },
          name: view.name,
          path: view.path,
          saved: fingerprint(tab.draft, tab.params),
          redactedFromHistory: false,
        }));
        set({ savingTabId: null });
        get().notify("ok", `Guardada como «${name}».`);
        void get().refreshVariables();
      } catch (err) {
        fail(err);
      }
    },

    closeSaveDialog: () => set({ savingTabId: null }),

    switchProtocol: (id, target) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab || (tab.kind !== "request" && tab.kind !== "realtime" && tab.kind !== "grpc") || tab.source) return;
      if (tab.kind !== "request" && tab.state !== "idle") return get().notify("err", "Desconecta o cancela antes de cambiar de protocolo.");
      const url = tab.kind === "grpc" ? tab.draft.target : tab.draft.url;
      const headers = tab.kind === "grpc" ? tab.draft.metadata : tab.draft.headers;
      let next: Tab;
      if (target === "websocket" || target === "socketio") {
        if (tab.kind === "realtime") return get().setRealtimeDraft(id, (d) => ({ ...d, protocol: target, url: d.url ? realtimeUrl(d.url, target) : "" }));
        next = realtimeTab({ ...emptyRealtime(target, url ? realtimeUrl(url, target) : ""), headers });
      } else if (target === "grpc") {
        if (tab.kind === "grpc") return;
        next = grpcTab({ ...emptyGrpc(url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? ""), metadata: headers });
      } else {
        if (tab.kind === "request") return get().setDraft(id, (d) => ({ ...d, method: target }));
        next = requestTab({ ...emptyRequest(), method: target, url: url.replace(/^ws(s?):\/\//i, "http$1://"), headers });
      }
      next = { ...next, id: tab.id };
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? next : t)) }));
    },

    patchGrpc: (id, patch) => mapGrpc((t) => t.id === id, (t) => ({ ...t, ...patch })),

    setGrpcDraft: (id, update) => mapGrpc((t) => t.id === id, (t) => ({ ...t, draft: update(t.draft) })),

    describeGrpc: async (id) => {
      const tab = findGrpc(id);
      if (!tab || tab.describing) return;
      get().patchGrpc(id, { describing: true, describeError: null });
      const result = await window.sendix.engine.call("grpc.describe", { request: tab.draft, source: tab.source });
      mapGrpc(
        (t) => t.id === id,
        (t) => {
          if (!result.ok) return { ...t, describing: false, describeError: { code: result.error.code, message: result.error.message } };
          const r = result.value;
          if (r.kind === "error") return { ...t, describing: false, describeError: { code: r.code, message: r.message } };
          // Keep the chosen method if it still exists; otherwise pick the first one.
          const exists = r.services.some((s) => s.name === t.draft.service && s.methods.some((m) => m.name === t.draft.method));
          const first = r.services[0];
          const method = first?.methods[0];
          const draft =
            exists || !first || !method
              ? t.draft
              : { ...t.draft, service: first.name, method: method.name, message: t.draft.message.trim() === "{}" || !t.draft.message.trim() ? method.example : t.draft.message };
          return { ...t, describing: false, services: r.services, draft };
        },
      );
    },

    invokeGrpc: async (id) => {
      const tab = findGrpc(id);
      if (!tab || tab.state !== "idle") return;
      const callId = crypto.randomUUID();
      mapGrpc((t) => t.id === id, (t) => ({ ...t, callId, state: "starting", halfClosed: false, startedAt: Date.now(), log: [], headers: [], status: null, startError: null, selected: null, responsePanel: "response" }));
      const result = await window.sendix.engine.call("grpc.start", { callId, request: tab.draft, source: tab.source });
      mapGrpc(
        (t) => t.callId === callId,
        (t) => {
          if (!result.ok) return { ...t, callId: null, state: "idle", startError: { code: result.error.code, message: result.error.message } };
          const r = result.value;
          if (r.kind === "error") return { ...t, callId: null, state: "idle", startError: { code: r.code, message: r.message } };
          // The status may already have arrived for a fast unary call.
          return t.status ? { ...t, callType: r.type } : { ...t, callType: r.type, state: "running" };
        },
      );
    },

    sendGrpc: async (id) => {
      const tab = findGrpc(id);
      if (!tab?.callId || tab.state !== "running" || tab.halfClosed) return;
      const result = await window.sendix.engine.call("grpc.send", { callId: tab.callId, message: tab.draft.message, source: tab.source });
      if (!result.ok) return get().notify("err", result.error.message);
      if (!result.value.sent) get().notify("err", result.value.error ?? "No se pudo enviar el mensaje.");
    },

    endGrpc: async (id) => {
      const tab = findGrpc(id);
      if (!tab?.callId || tab.state !== "running") return;
      get().patchGrpc(id, { halfClosed: true });
      await window.sendix.engine.call("grpc.end", { callId: tab.callId });
    },

    cancelGrpc: async (id) => {
      const tab = findGrpc(id);
      if (!tab?.callId) return;
      await window.sendix.engine.call("grpc.cancel", { callId: tab.callId });
    },

    onGrpcEvent: (event) =>
      mapGrpc(
        (t) => t.callId === event.callId,
        (t) => {
          if (event.type === "headers") return { ...t, headers: event.headers };
          if (event.type === "message") {
            const log = [...t.log, { seq: ++logSeq, dir: event.dir, at: event.at, text: event.text, size: event.size, truncated: event.truncated }];
            return { ...t, log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log };
          }
          return { ...t, callId: null, state: "idle", status: event };
        },
      ),

    pickGrpcFiles: async (id, kind) => {
      const paths = await window.sendix.grpc.pick(kind);
      if (!paths.length) return;
      get().setGrpcDraft(id, (d) => {
        if (kind === "proto") return { ...d, definition: { ...d.definition, source: "files", files: [...new Set([...d.definition.files, ...paths])] } };
        if (kind === "importPath") return { ...d, definition: { ...d.definition, importPaths: [...new Set([...d.definition.importPaths, ...paths])] } };
        const key = kind === "ca" ? "caFile" : kind === "cert" ? "certFile" : "keyFile";
        return { ...d, settings: { ...d.settings, [key]: paths[0]! } };
      });
    },

    patchRealtime: (id, patch) => mapRealtime((t) => t.id === id, (t) => ({ ...t, ...patch })),

    setRealtimeDraft: (id, update) => mapRealtime((t) => t.id === id, (t) => ({ ...t, draft: update(t.draft) })),

    connect: async (id) => {
      const tab = findRealtime(id);
      if (!tab || tab.state !== "idle" || tab.draft.url.trim() === "") return;
      const connId = crypto.randomUUID();
      const request = { ...tab.draft, url: realtimeUrl(tab.draft.url, tab.draft.protocol) };
      mapRealtime(
        (t) => t.id === id,
        (t) => ({ ...t, connId, state: "connecting", failure: null, handshake: null, messageCount: 0, log: appendLog(t, { kind: "info", at: Date.now(), text: `Conectando a ${request.url}…` }) }),
      );
      const result = await window.sendix.engine.call("realtime.connect", { connId, request, source: tab.source });
      mapRealtime(
        (t) => t.connId === connId,
        (t) => {
          if (!result.ok) return { ...t, connId: null, state: "idle", failure: { code: result.error.code, message: result.error.message, status: null } };
          const r = result.value;
          if (r.kind === "error") {
            return { ...t, connId: null, state: "idle", failure: { code: r.code, message: r.message, status: r.status }, log: appendLog(t, { kind: "error", at: Date.now(), text: r.message }) };
          }
          // A close requested while connecting is applied now that the connection exists.
          if (t.state === "closing") void window.sendix.engine.call("realtime.close", { connId });
          return { ...t, state: t.state === "closing" ? "closing" : "open", openedAt: Date.now(), handshake: r.handshake, log: appendLog(t, { kind: "open", at: Date.now(), text: "Conectado" }) };
        },
      );
    },

    disconnect: async (id) => {
      const tab = findRealtime(id);
      if (!tab?.connId || tab.state === "idle") return;
      const { connId, state } = tab;
      mapRealtime((t) => t.id === id, (t) => ({ ...t, state: "closing" }));
      if (state !== "connecting") await window.sendix.engine.call("realtime.close", { connId });
    },

    sendMessage: async (id) => {
      const tab = findRealtime(id);
      if (!tab?.connId || tab.state !== "open") return;
      const result = await window.sendix.engine.call("realtime.send", { connId: tab.connId, message: tab.composer, source: tab.source });
      if (!result.ok) return get().notify("err", result.error.message);
      if (!result.value.sent) get().notify("err", result.value.error ?? "No se pudo enviar el mensaje.");
    },

    onRealtimeEvent: (event) =>
      mapRealtime(
        (t) => t.connId === event.connId,
        (t) => {
          switch (event.type) {
            case "message":
              return { ...t, messageCount: t.messageCount + 1, log: appendLog(t, { kind: "message", at: event.message.at, message: event.message }) };
            case "info":
              return { ...t, log: appendLog(t, { kind: "info", at: event.at, text: event.text }) };
            case "error":
              return { ...t, log: appendLog(t, { kind: "error", at: event.at, text: event.message }) };
            case "open":
              return { ...t, state: t.state === "closing" ? "closing" : "open", handshake: event.handshake, log: appendLog(t, { kind: "open", at: event.at, text: "Reconectado" }) };
            case "closed": {
              const record: ConnectionRecord = { start: t.openedAt ?? event.at, end: event.at, code: event.code, reason: event.reason, messages: t.messageCount };
              const text = event.byUser ? "Desconectado por ti" : `Conexión cerrada${event.code !== null ? ` (${event.code})` : ""}${event.reason ? `: ${event.reason}` : ""}`;
              return {
                ...t,
                connId: null,
                state: "idle",
                openedAt: null,
                connections: [record, ...t.connections].slice(0, 10),
                log: appendLog(t, { kind: "closed", at: event.at, text }),
              };
            }
          }
        },
      ),
  };
});

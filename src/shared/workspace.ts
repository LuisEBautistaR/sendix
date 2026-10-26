/** What the renderer sees of a workspace folder. Files stay in main; the UI gets views. */
import type { FolderVariable, ScriptLevel, TreeNode } from "./collection";
import type { HttpRequest, KeyValue, RequestAuth, RequestScripts } from "./http";
import type { RealtimeRequest } from "./realtime";
import type { GrpcRequest } from "./grpc";

export interface CollectionSummary {
  id: string;
  name: string;
  /** File name inside collections/ (shown so users can find it in git). */
  file: string;
  tree: TreeNode[];
  /** Whether the collection itself has a pre-request or test script. */
  scripts: boolean;
  /** How many variables the collection defines. */
  variables: number;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  file: string;
}

export interface WorkspaceSnapshot {
  path: string;
  name: string;
  collections: CollectionSummary[];
  environments: EnvironmentSummary[];
  activeEnvironmentId: string | null;
  /** Whether scripts set variables that live only until the app closes. */
  sessionValues: boolean;
  /** Files that could not be read (invalid JSON, unsupported format), with the reason. */
  problems: Array<{ file: string; reason: string }>;
}

export interface ItemView {
  collectionId: string;
  itemId: string;
  name: string;
  /** Folder names from the collection down to the item's parent. */
  path: string[];
  request: HttpRequest;
  disabledParams: KeyValue[];
  /** Set for WebSocket and Socket.IO connections; `request` is then only their URL and headers. */
  realtime: RealtimeRequest | null;
  /** Set for gRPC calls. */
  grpc: GrpcRequest | null;
}

/** A collection (folderId null) or folder, as its settings tab shows it. */
export interface FolderView {
  collectionId: string;
  folderId: string | null;
  name: string;
  /** Folder names from the collection down to the folder's parent. */
  path: string[];
  description: string;
  scripts: RequestScripts;
  auth: RequestAuth;
  variables: FolderVariable[];
  /** The levels above with scripts, in running order. */
  inherited: ScriptLevel[];
  /** Requests inside, at any depth. */
  requests: number;
}

export interface EnvironmentRow {
  key: string;
  /** Empty for secrets: their value never leaves main. */
  value: string;
  enabled: boolean;
  secret: boolean;
  /** Secret rows only: whether a value is stored. */
  hasValue: boolean;
}

export interface EnvironmentView {
  id: string;
  name: string;
  rows: EnvironmentRow[];
}

/** A row sent back by the editor. For secrets, `value` replaces the stored one unless `keepSecret` is set. */
export interface EnvironmentRowInput {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
  keepSecret: boolean;
}

export interface VariableView {
  key: string;
  /** null for secrets. */
  value: string | null;
  secret: boolean;
  /** "sesión": set by a script while the app runs, not saved to disk. */
  source: "entorno" | "colección" | "sesión";
}

export type ImportKind = "collection" | "environment" | "openapi" | "har";
export interface ImportResult {
  kind: ImportKind;
  name: string;
  /** Requests imported (collections) or variables (environments). */
  count: number;
  /** Ids to open after importing. */
  collectionId?: string;
  environmentId?: string;
  notes: string[];
}

export interface RecentWorkspace {
  path: string;
  name: string;
  openedAt: number;
}

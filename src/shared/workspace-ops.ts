/**
 * Every workspace operation the renderer may ask main for, with its argument
 * contract. Main validates arguments with these schemas; the preload only
 * forwards the operation name, so it never imports zod.
 */
import { z } from "zod";
import { authSchema, httpRequestSchema, keyValueSchema, requestSourceSchema, scriptsSchema } from "./http";
import { realtimeRequestSchema } from "./realtime";
import { grpcRequestSchema } from "./grpc";
import type { EnvironmentView, FolderView, ImportResult, ItemView, RecentWorkspace, VariableView, WorkspaceSnapshot } from "./workspace";

const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(200);

export const workspaceOps = {
  current: z.object({}),
  /** Opens the OS folder picker in main; the renderer never supplies a path. */
  openFolder: z.object({}),
  openRecent: z.object({ path: z.string().min(1).max(4_096) }),
  recent: z.object({}),
  close: z.object({}),
  reveal: z.object({}),

  getItem: requestSourceSchema,
  saveItem: z.object({ source: requestSourceSchema, request: httpRequestSchema, disabledParams: z.array(keyValueSchema).max(500) }),
  createRequest: z.object({
    collectionId: id,
    parentId: id.nullable(),
    name,
    request: httpRequestSchema,
    disabledParams: z.array(keyValueSchema).max(500),
  }),
  saveRealtimeItem: z.object({ source: requestSourceSchema, realtime: realtimeRequestSchema }),
  createRealtimeRequest: z.object({ collectionId: id, parentId: id.nullable(), name, realtime: realtimeRequestSchema }),
  saveGrpcItem: z.object({ source: requestSourceSchema, grpc: grpcRequestSchema }),
  createGrpcRequest: z.object({ collectionId: id, parentId: id.nullable(), name, grpc: grpcRequestSchema }),
  createFolder: z.object({ collectionId: id, parentId: id.nullable(), name }),
  renameItem: z.object({ collectionId: id, itemId: id, name }),
  removeItem: z.object({ collectionId: id, itemId: id }),
  duplicateItem: z.object({ collectionId: id, itemId: id }),
  /** Scripts, auth and variables of the collection (folderId null) or of a folder. */
  getFolder: z.object({ collectionId: id, folderId: id.nullable() }),
  saveFolder: z.object({
    collectionId: id,
    folderId: id.nullable(),
    scripts: scriptsSchema,
    auth: authSchema,
    variables: z.array(keyValueSchema.extend({ value: z.string().max(4_194_304), secret: z.boolean() })).max(5_000),
  }),

  createCollection: z.object({ name }),
  renameCollection: z.object({ collectionId: id, name }),
  deleteCollection: z.object({ collectionId: id }),

  getEnvironment: z.object({ environmentId: id }),
  saveEnvironment: z.object({
    environmentId: id,
    name,
    rows: z
      .array(z.object({ key: z.string().max(1_024), value: z.string().max(1_048_576), enabled: z.boolean(), secret: z.boolean(), keepSecret: z.boolean() }))
      .max(5_000),
  }),
  createEnvironment: z.object({ name }),
  deleteEnvironment: z.object({ environmentId: id }),
  setActiveEnvironment: z.object({ environmentId: id.nullable() }),
  variables: z.object({ collectionId: id.nullable() }),
  /** Forgets the values scripts set during this session. */
  clearSession: z.object({}),

  /** Opens the OS file picker in main and imports what it finds. */
  importFile: z.object({}),
} as const;

export type WorkspaceOp = keyof typeof workspaceOps;
export type WorkspaceArgs<O extends WorkspaceOp> = z.input<(typeof workspaceOps)[O]>;

export interface WorkspaceResults {
  current: WorkspaceSnapshot | null;
  openFolder: WorkspaceSnapshot | null;
  openRecent: WorkspaceSnapshot;
  recent: RecentWorkspace[];
  close: null;
  reveal: null;
  getItem: ItemView;
  saveItem: null;
  createRequest: { itemId: string };
  saveRealtimeItem: null;
  createRealtimeRequest: { itemId: string };
  saveGrpcItem: null;
  createGrpcRequest: { itemId: string };
  createFolder: { itemId: string };
  renameItem: null;
  removeItem: null;
  duplicateItem: { itemId: string };
  getFolder: FolderView;
  saveFolder: null;
  createCollection: { collectionId: string };
  renameCollection: null;
  deleteCollection: null;
  getEnvironment: EnvironmentView;
  saveEnvironment: null;
  createEnvironment: { environmentId: string };
  deleteEnvironment: null;
  setActiveEnvironment: null;
  variables: VariableView[];
  clearSession: null;
  importFile: ImportResult | null;
}

export function isWorkspaceOp(value: unknown): value is WorkspaceOp {
  return typeof value === "string" && Object.hasOwn(workspaceOps, value);
}

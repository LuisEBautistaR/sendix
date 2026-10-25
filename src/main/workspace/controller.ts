/**
 * The renderer's door to the open workspace. Holds the current Workspace,
 * remembers recent folders and the active environment, shows the OS pickers
 * (so the renderer never chooses paths) and broadcasts a fresh snapshot after
 * every change.
 */
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ErrorCodes, type Outcome } from "@shared/rpc";
import { IpcChannels } from "@shared/ipc";
import { isWorkspaceOp, workspaceOps, type WorkspaceArgs, type WorkspaceOp, type WorkspaceResults } from "@shared/workspace-ops";
import type { ImportResult, WorkspaceSnapshot } from "@shared/workspace";
import type { RequestSource, SendContext, SessionChanges } from "@shared/http";
import { collectionName } from "@shared/collection";
import { Workspace, WorkspaceError, type SecretStore } from "./workspace";
import { countRequests, detectImport, harToCollection, normalizeCollection } from "./importers";
import type { SettingsStore } from "../settings";
import type { EngineHost } from "../engine-host";
import { isTrustedSender } from "../security";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

type Handler<O extends WorkspaceOp> = (args: WorkspaceArgs<O>) => Promise<WorkspaceResults[O]> | WorkspaceResults[O];

export class WorkspaceController {
  #workspace: Workspace | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly engine: EngineHost,
  ) {}

  get workspace(): Workspace | null {
    return this.#workspace;
  }

  /** Context for a send: what main adds to the renderer's request. */
  contextFor(source: RequestSource | null): SendContext | null {
    return this.#workspace ? this.#workspace.contextFor(source) : null;
  }

  /** Keeps what a send's scripts set, then tells the renderer so previews update. */
  applySession(changes: SessionChanges, collectionId: string | null): void {
    if (!this.#workspace || (!changes.environment.length && !changes.collection.length)) return;
    this.#workspace.applySession(changes, collectionId);
    this.#changed();
  }

  async restoreLast(): Promise<void> {
    const last = this.settings.data.lastWorkspace;
    if (!last) return;
    try {
      await this.#open(last);
    } catch (err) {
      console.error("[main] Could not reopen the last workspace", err);
    }
  }

  async #open(path: string): Promise<WorkspaceSnapshot> {
    const info = await stat(path);
    if (!info.isDirectory()) throw new WorkspaceError("NOT_FOUND", "La carpeta ya no existe");
    const ws = await Workspace.open(path, { secrets: this.secrets, newId: randomUUID });
    ws.setActiveEnvironment(this.settings.data.activeEnvironment[path] ?? null);
    this.#workspace = ws;
    const snap = ws.snapshot();
    await this.settings.rememberWorkspace(path, snap.name);
    return snap;
  }

  #ws(): Workspace {
    if (!this.#workspace) throw new WorkspaceError("NOT_FOUND", "No hay una carpeta de trabajo abierta");
    return this.#workspace;
  }

  #changed(): void {
    const snap = this.#workspace?.snapshot() ?? null;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IpcChannels.workspaceChanged, snap);
    }
  }

  async #import(): Promise<ImportResult | null> {
    const ws = this.#ws();
    const picked = await dialog.showOpenDialog({
      title: "Importar",
      properties: ["openFile"],
      filters: [
        { name: "Colecciones, entornos, OpenAPI y HAR", extensions: ["json", "yaml", "yml", "har"] },
        { name: "Todos los archivos", extensions: ["*"] },
      ],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    if ((await stat(file)).size > MAX_IMPORT_BYTES) throw new WorkspaceError("INVALID", "El archivo supera 20 MB.");
    const detected = detectImport(await readFile(file, "utf8"));
    const fileName = basename(file).replace(/\.(json|ya?ml|har)$/i, "");

    switch (detected.kind) {
      case "collection": {
        const json = normalizeCollection(detected.json);
        const collectionId = await ws.addCollection(json);
        return { kind: "collection", name: collectionName(json), count: countRequests(json), collectionId, notes: [] };
      }
      case "environment": {
        const environmentId = await ws.addEnvironment(detected.json);
        const values = Array.isArray(detected.json["values"]) ? detected.json["values"].length : 0;
        return { kind: "environment", name: String(detected.json["name"] ?? fileName), count: values, environmentId, notes: [] };
      }
      case "har": {
        const { collection, count, notes } = harToCollection(detected.json, fileName);
        const collectionId = await ws.addCollection(collection);
        return { kind: "har", name: fileName, count, collectionId, notes };
      }
      case "openapi": {
        const outcome = await this.engine.call("import.openapi", { text: detected.text }, 120_000);
        if (!outcome.ok) throw new WorkspaceError("INVALID", `No se pudo convertir la definición OpenAPI: ${outcome.error.message}`);
        const json = normalizeCollection(outcome.value.collection);
        const collectionId = await ws.addCollection(json);
        return { kind: "openapi", name: collectionName(json), count: countRequests(json), collectionId, notes: outcome.value.warnings };
      }
      case "unknown":
        throw new WorkspaceError("INVALID", detected.reason);
    }
  }

  readonly #handlers: { [O in WorkspaceOp]: Handler<O> } = {
    current: () => this.#workspace?.snapshot() ?? null,
    openFolder: async () => {
      const picked = await dialog.showOpenDialog({
        title: "Abrir o crear una carpeta de trabajo",
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Usar esta carpeta",
      });
      const path = picked.filePaths[0];
      if (picked.canceled || !path) return null;
      return this.#open(path);
    },
    openRecent: ({ path }) => {
      // Only folders the user picked before can be reopened by path.
      if (!this.settings.data.recentWorkspaces.some((r) => r.path === path)) throw new WorkspaceError("NOT_FOUND", "Esa carpeta no está entre las recientes");
      return this.#open(path);
    },
    recent: () => [...this.settings.data.recentWorkspaces],
    close: async () => {
      this.#workspace = null;
      await this.settings.update((d) => (d.lastWorkspace = null));
      return null;
    },
    reveal: () => {
      void shell.openPath(this.#ws().path);
      return null;
    },

    getItem: (source) => this.#ws().getItem(source),
    saveItem: async ({ source, request, disabledParams }) => {
      await this.#ws().saveItem(source, request, disabledParams);
      return null;
    },
    saveRealtimeItem: async ({ source, realtime }) => {
      await this.#ws().saveRealtimeItem(source, realtime);
      return null;
    },
    createRealtimeRequest: async ({ collectionId, parentId, name, realtime }) => ({
      itemId: await this.#ws().createRealtimeRequest(collectionId, parentId, name, realtime),
    }),
    saveGrpcItem: async ({ source, grpc }) => {
      await this.#ws().saveGrpcItem(source, grpc);
      return null;
    },
    createGrpcRequest: async ({ collectionId, parentId, name, grpc }) => ({
      itemId: await this.#ws().createGrpcRequest(collectionId, parentId, name, grpc),
    }),
    createRequest: async ({ collectionId, parentId, name, request, disabledParams }) => ({
      itemId: await this.#ws().createRequest(collectionId, parentId, name, request, disabledParams),
    }),
    createFolder: async ({ collectionId, parentId, name }) => ({ itemId: await this.#ws().createFolder(collectionId, parentId, name) }),
    renameItem: async ({ collectionId, itemId, name }) => {
      await this.#ws().renameItem(collectionId, itemId, name);
      return null;
    },
    removeItem: async ({ collectionId, itemId }) => {
      await this.#ws().removeItem(collectionId, itemId);
      return null;
    },
    duplicateItem: async ({ collectionId, itemId }) => ({ itemId: await this.#ws().duplicateItem(collectionId, itemId) }),

    createCollection: async ({ name }) => ({ collectionId: await this.#ws().createCollection(name) }),
    renameCollection: async ({ collectionId, name }) => {
      await this.#ws().renameCollection(collectionId, name);
      return null;
    },
    deleteCollection: async ({ collectionId }) => {
      await this.#ws().deleteCollection(collectionId);
      return null;
    },

    getEnvironment: ({ environmentId }) => this.#ws().getEnvironment(environmentId),
    saveEnvironment: async ({ environmentId, name, rows }) => {
      await this.#ws().saveEnvironment(environmentId, name, rows);
      return null;
    },
    createEnvironment: async ({ name }) => ({ environmentId: await this.#ws().createEnvironment(name) }),
    deleteEnvironment: async ({ environmentId }) => {
      await this.#ws().deleteEnvironment(environmentId);
      return null;
    },
    setActiveEnvironment: async ({ environmentId }) => {
      const ws = this.#ws();
      ws.setActiveEnvironment(environmentId);
      await this.settings.update((d) => {
        if (environmentId) d.activeEnvironment[ws.path] = environmentId;
        else delete d.activeEnvironment[ws.path];
      });
      return null;
    },
    variables: ({ collectionId }) => this.#workspace?.variablesFor(collectionId) ?? [],

    importFile: () => this.#import(),
    clearSession: () => {
      this.#ws().clearSession();
      return null;
    },
  };

  /** Operations that do not change the workspace, so no snapshot broadcast is needed. */
  static readonly #readOnly = new Set<WorkspaceOp>(["current", "recent", "getItem", "getEnvironment", "variables", "reveal"]);

  register(): void {
    ipcMain.handle(IpcChannels.workspaceOp, async (event, op: unknown, args: unknown): Promise<Outcome<unknown>> => {
      if (!isTrustedSender(event.senderFrame)) return { ok: false, error: { code: ErrorCodes.forbidden, message: "Untrusted sender" } };
      if (!isWorkspaceOp(op)) return { ok: false, error: { code: ErrorCodes.unknownMethod, message: `Unknown operation "${String(op)}"` } };
      const parsed = workspaceOps[op].safeParse(args ?? {});
      if (!parsed.success) return { ok: false, error: { code: ErrorCodes.invalidParams, message: parsed.error.message } };
      try {
        const handler = this.#handlers[op] as Handler<typeof op>;
        const value = await handler(parsed.data as WorkspaceArgs<typeof op>);
        if (!WorkspaceController.#readOnly.has(op)) this.#changed();
        return { ok: true, value };
      } catch (err) {
        if (err instanceof WorkspaceError) return { ok: false, error: { code: err.code, message: err.message } };
        console.error(`[main] Workspace operation ${op} failed`, err);
        return { ok: false, error: { code: "WORKSPACE_FAILED", message: (err as Error).message } };
      }
    });
  }
}

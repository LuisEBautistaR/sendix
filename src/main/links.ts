/**
 * sendix:// links (Mockix: «Abrir en Sendix») and the way out to Mockix
 * («Crear mock desde esta colección»). A link only becomes a pending request the
 * window shows; it opens a tab after the user confirms, and never sends anything.
 */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { app, ipcMain, shell } from "electron";
import { IpcChannels } from "@shared/ipc";
import { MOCKIX_SCHEME, SENDIX_SCHEME, ensureSendixProtocol, mockixImportLink, parseSendixLink, type LinkedRequest } from "@shared/links";
import type { WorkspaceController } from "./workspace/controller";
import { isTrustedSender } from "./security";

export interface PendingLink {
  id: string;
  request: LinkedRequest;
}

/** Links that waited for the window are kept a short while; older ones are dropped. */
const MAX_PENDING = 10;

export class LinkService {
  readonly #pending = new Map<string, PendingLink>();

  constructor(
    private readonly workspaces: WorkspaceController,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    private readonly log: (message: string, detail?: unknown) => void,
  ) {}

  /**
   * Registers sendix:// with Windows for this installation (packaged builds only), and
   * again on focus: an update could remove it after the start, and Mockix only offers
   * its «Sendix» button while it exists.
   */
  registerProtocol(): void {
    if (!app.isPackaged) return;
    ensureSendixProtocol(app);
    app.on("browser-window-focus", () => ensureSendixProtocol(app) && this.log(`registered ${SENDIX_SCHEME}:// again`));
  }

  handle(raw: string): void {
    const parsed = parseSendixLink(raw);
    if (!parsed.ok) return this.log(`ignored a ${SENDIX_SCHEME}:// link: ${parsed.reason}`);
    const link: PendingLink = { id: randomUUID(), request: parsed.request };
    this.#pending.set(link.id, link);
    while (this.#pending.size > MAX_PENDING) this.#pending.delete(this.#pending.keys().next().value as string);
    this.broadcast(IpcChannels.linkRequest, link);
  }

  /** Whether Mockix registered mockix:// on this machine. */
  static mockixInstalled(): boolean {
    return process.platform === "win32" && app.getApplicationNameForProtocol(`${MOCKIX_SCHEME}://`) !== "";
  }

  register(): void {
    ipcMain.handle(IpcChannels.linksPending, (event) => (isTrustedSender(event.senderFrame) ? [...this.#pending.values()] : null));
    // Accepting only removes it from the list; the window opens the tab it already showed.
    ipcMain.handle(IpcChannels.linkDecide, (event, id: unknown): PendingLink | null => {
      if (!isTrustedSender(event.senderFrame) || typeof id !== "string") return null;
      const link = this.#pending.get(id) ?? null;
      this.#pending.delete(id);
      return link;
    });
    ipcMain.handle(IpcChannels.mockixAvailable, (event) => isTrustedSender(event.senderFrame) && LinkService.mockixInstalled());
    ipcMain.handle(IpcChannels.mockixImport, async (event, collectionId: unknown): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (!isTrustedSender(event.senderFrame) || typeof collectionId !== "string") return { ok: false, message: "Petición no válida" };
      if (!LinkService.mockixInstalled()) return { ok: false, message: "Mockix no está instalado en este equipo." };
      const ws = this.workspaces.workspace;
      if (!ws) return { ok: false, message: "Abre una carpeta de trabajo primero." };
      let file: string;
      try {
        // The workspace already keeps each collection as a v2.1 file: hand that one over.
        file = await ws.collectionFile(collectionId);
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
      // Mockix refuses a workspace that is not its own, so only pass the folder when it is one too.
      const mockixWorkspace = (await stat(join(ws.path, "mockix.workspace.yaml")).catch(() => null)) ? ws.path : null;
      await shell.openExternal(mockixImportLink(file, mockixWorkspace));
      return { ok: true };
    });
  }
}

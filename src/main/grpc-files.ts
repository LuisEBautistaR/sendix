/**
 * The engine reads .proto files and certificates from disk for gRPC. So that a
 * compromised renderer cannot point it at arbitrary files, main only passes on
 * paths the user picked in a dialog during this session, or that saved gRPC
 * calls of the open workspace refer to.
 */
import { resolve } from "node:path";
import { dialog, ipcMain } from "electron";
import { IpcChannels } from "@shared/ipc";
import type { GrpcRequest } from "@shared/grpc";
import type { WorkspaceController } from "./workspace/controller";
import { isTrustedSender } from "./security";

export const GRPC_PICK_KINDS = ["proto", "importPath", "ca", "cert", "key"] as const;
export type GrpcPickKind = (typeof GRPC_PICK_KINDS)[number];

const norm = (p: string) => {
  const abs = resolve(p);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
};

export class GrpcFiles {
  readonly #picked = new Set<string>();

  constructor(private readonly workspaces: WorkspaceController) {}

  register(): void {
    ipcMain.handle(IpcChannels.grpcPick, async (event, kind: unknown): Promise<string[]> => {
      if (!isTrustedSender(event.senderFrame) || !GRPC_PICK_KINDS.includes(kind as GrpcPickKind)) return [];
      const k = kind as GrpcPickKind;
      const picked = await dialog.showOpenDialog({
        title: k === "proto" ? "Archivos .proto" : k === "importPath" ? "Carpeta de importación" : "Certificado o clave PEM",
        properties: k === "proto" ? ["openFile", "multiSelections"] : k === "importPath" ? ["openDirectory"] : ["openFile"],
        filters:
          k === "proto"
            ? [{ name: "Protocol Buffers", extensions: ["proto"] }]
            : k === "importPath"
              ? []
              : [
                  { name: "PEM", extensions: ["pem", "crt", "cer", "key"] },
                  { name: "Todos los archivos", extensions: ["*"] },
                ],
      });
      if (picked.canceled) return [];
      for (const p of picked.filePaths) this.#picked.add(norm(p));
      return picked.filePaths;
    });
  }

  /** The first path of the request that the engine may not read, or null. Variables in paths are not allowed. */
  forbiddenPath(request: GrpcRequest): string | null {
    const paths = [
      ...(request.definition.source === "files" ? [...request.definition.files, ...request.definition.importPaths] : []),
      ...(request.settings.tls === "none" ? [] : [request.settings.caFile, request.settings.certFile, request.settings.keyFile]),
    ].filter(Boolean);
    if (!paths.length) return null;
    const saved = new Set((this.workspaces.workspace?.grpcPaths() ?? []).map(norm));
    return paths.find((p) => p.includes("{{") || (!this.#picked.has(norm(p)) && !saved.has(norm(p)))) ?? null;
  }
}

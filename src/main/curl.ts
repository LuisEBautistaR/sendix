/**
 * «Copiar como cURL». Main builds the command because only main knows inherited auth
 * and secret values. The window only ever gets the version with secrets hidden; when
 * the user asks for secrets, the full command goes straight to the clipboard from here.
 */
import { clipboard, ipcMain } from "electron";
import { IpcChannels } from "@shared/ipc";
import { authFromItem } from "@shared/collection";
import type { HttpRequest, RequestAuth } from "@shared/http";
import { curlBuildSchema, requestToCurl, type CurlBuildResult, type CurlVariable } from "@shared/curl-export";
import type { WorkspaceController } from "./workspace/controller";
import type { PrefsService } from "./prefs";
import { isTrustedSender } from "./security";

/** The auth that applies: the request's own, or the nearest folder's or the collection's. */
function effectiveAuth(auth: RequestAuth, chain: ReadonlyArray<Record<string, unknown> | null>): RequestAuth {
  if (auth.type !== "inherit") return auth;
  for (let i = chain.length - 1; i >= 0; i--) {
    const level = chain[i];
    if (level) return authFromItem(level);
  }
  return { type: "none" };
}

export function registerCurl(workspaces: WorkspaceController, prefs: PrefsService): void {
  ipcMain.handle(IpcChannels.curlBuild, (event, raw: unknown): CurlBuildResult => {
    if (!isTrustedSender(event.senderFrame)) return null;
    const parsed = curlBuildSchema.safeParse(raw);
    if (!parsed.success) return null;
    const { request, source, options, copy } = parsed.data;
    const context = workspaces.contextFor(source);
    // Environment values win over collection variables, as when sending.
    const variables: CurlVariable[] = context ? [...context.collectionVariables, ...context.environment] : [];
    const global = prefs.prefs.request;
    const effective: HttpRequest = {
      ...request,
      auth: effectiveAuth(request.auth, context?.authChain ?? []),
      settings: {
        ...request.settings,
        verifyTls: request.settings.verifyTls && global.verifyTls,
        followRedirects: request.settings.followRedirects && global.followRedirects,
      },
    };

    const shown = requestToCurl(effective, variables, { ...options, includeSecrets: false });
    if (!copy) return { ...shown, copied: false };
    clipboard.writeText(options.includeSecrets ? requestToCurl(effective, variables, options).command : shown.command);
    return { ...shown, copied: true };
  });
}

/**
 * HTML response previews. The renderer hands the body over and gets an app://sendix/__preview/<id>
 * URL for a sandboxed iframe: no scripts, no network, its own CSP that only allows inline styles
 * and data: images, and navigation away from it is blocked in security.ts.
 */
import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IpcChannels } from "@shared/ipc";
import { APP_ORIGIN } from "./app-path";
import { isTrustedSender } from "./security";

export const PREVIEW_PREFIX = "/__preview/";
const MAX_PREVIEWS = 20;
const MAX_PREVIEW_CHARS = 10 * 1024 * 1024;

export const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const previews = new Map<string, string>();

export function previewHtml(pathname: string): string | null {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return null;
  return previews.get(pathname.slice(PREVIEW_PREFIX.length)) ?? null;
}

export function registerPreviews(): void {
  ipcMain.handle(IpcChannels.previewPut, (event, html: unknown): string | null => {
    if (!isTrustedSender(event.senderFrame) || typeof html !== "string" || html.length > MAX_PREVIEW_CHARS) return null;
    const id = randomUUID();
    previews.set(id, html);
    // Oldest first out: a Map keeps insertion order.
    while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value as string);
    return `${APP_ORIGIN}${PREVIEW_PREFIX}${id}`;
  });
}

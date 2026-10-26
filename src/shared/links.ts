/**
 * Links between Sendix and Mockix. Neither app acts on a link by itself: the receiver
 * validates it, shows it and only acts after the user confirms.
 *
 *   sendix://request?method=POST&url=<http(s) URL>[&headers=<JSON object>][&body=<text>]
 *     (Mockix's «Abrir en Sendix»; opens a new, unsaved request tab)
 *   mockix://import?collection=<absolute .json>[&workspace=<Mockix workspace folder>]
 *     (Sendix's «Crear mock desde esta colección»)
 */
import { z } from "zod";

export const SENDIX_SCHEME = "sendix";
export const MOCKIX_SCHEME = "mockix";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const MAX_LINK = 128 * 1024;
const MAX_BODY = 64 * 1024;
const MAX_HEADERS = 50;

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,200}$/;

const requestLinkSchema = z.object({
  method: z.enum(METHODS),
  url: z
    .string()
    .max(4_096)
    .refine((u) => {
      try {
        const parsed = new URL(u);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "";
      } catch {
        return false;
      }
    }, "una URL http(s)"),
  headers: z
    .string()
    .max(64 * 1024)
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === "") return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: "custom", message: "headers no es JSON" });
        return z.NEVER;
      }
      const record = z.record(z.string().regex(headerName), z.string().max(4_096)).safeParse(parsed);
      if (!record.success || Object.keys(record.data).length > MAX_HEADERS) {
        ctx.addIssue({ code: "custom", message: "headers debe ser un objeto de cabeceras válidas" });
        return z.NEVER;
      }
      return Object.entries(record.data).map(([key, value]) => ({ key, value }));
    }),
  body: z.string().max(MAX_BODY).optional(),
});

/** A request that arrived through sendix:// and passed validation. */
export interface LinkedRequest {
  method: (typeof METHODS)[number];
  url: string;
  headers: Array<{ key: string; value: string }>;
  body: string | null;
}

export type LinkParse = { ok: true; request: LinkedRequest } | { ok: false; reason: string };

/** Validates a sendix:// link. Anything unexpected is refused with a reason (for the log). */
export function parseSendixLink(raw: string): LinkParse {
  if (raw.length > MAX_LINK) return { ok: false, reason: "el enlace es demasiado largo" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "no es un enlace válido" };
  }
  if (url.protocol !== `${SENDIX_SCHEME}:`) return { ok: false, reason: `no es un enlace ${SENDIX_SCHEME}://` };
  const action = (url.hostname || url.pathname.replace(/^\/+/, "")).replace(/\/+$/, "").toLowerCase();
  if (action !== "request") return { ok: false, reason: `acción desconocida «${action}»` };
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) return { ok: false, reason: `«${key}» aparece dos veces` };
    seen.add(key);
  }
  const parsed = requestLinkSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "enlace"}: ${i.message}`).join("; ") };
  const { method, url: target, headers, body } = parsed.data;
  return { ok: true, request: { method, url: target, headers, body: body ?? null } };
}

/** The first sendix:// argument of a command line: Windows hands links to the app as arguments. */
export function linkFromArgv(argv: readonly string[]): string | null {
  return argv.find((a) => a.toLowerCase().startsWith(`${SENDIX_SCHEME}://`)) ?? null;
}

/** The link that asks Mockix to import a collection file (into one of its workspaces, if given). */
export function mockixImportLink(collectionFile: string, mockixWorkspace: string | null): string {
  const q = new URLSearchParams({ collection: collectionFile });
  if (mockixWorkspace) q.set("workspace", mockixWorkspace);
  return `${MOCKIX_SCHEME}://import?${q.toString()}`;
}

/**
 * User preferences from the Settings screen. Main owns them (settings.json) and
 * applies the request ones itself, so every path that sends (tabs, runner) obeys them.
 */
import { z } from "zod";
import type { HttpRequest } from "./http";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const filePath = z.string().min(1).max(1_024).nullable();

export const clientCertSchema = z.object({
  id: z.string().min(1).max(64),
  /** host or host:port (443 when there is no port). */
  host: z.string().min(1).max(256),
  /** CRT + KEY, or a PFX/P12 bundle. Paths only come from a file dialog in main. */
  certFile: filePath,
  keyFile: filePath,
  pfxFile: filePath,
});
export type ClientCert = z.infer<typeof clientCertSchema>;

export const networkSchema = z.object({
  proxy: z.object({
    /** none: direct; system: what Windows says (resolved per URL); custom: the server below. */
    mode: z.enum(["none", "system", "custom"]),
    /** host:port or http://host:port */
    server: z.string().max(512),
    username: z.string().max(256),
    /** Hosts that skip the proxy, separated by commas: exact names, *.domain or .domain. */
    bypass: z.string().max(4_096),
  }),
  /** Extra certificate authority (PEM), trusted on top of the system's. */
  caFile: filePath,
  clientCerts: z.array(clientCertSchema).max(50),
});
export type NetworkPrefs = z.infer<typeof networkSchema>;

/** Share of the screen width for the request side, in percent. */
export const SPLIT_MIN = 25;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 46;

export const prefsSchema = z.object({
  /** system follows Windows; light and dark pin the whole app, native title bar included. */
  theme: z.enum(THEMES),
  editor: z.object({
    fontSize: z.number().int().min(11).max(20),
    tabSize: z.union([z.literal(2), z.literal(4)]),
    closeBrackets: z.boolean(),
  }),
  request: z.object({
    /** Used for new requests and when a saved one is opened or run (1 s to 10 min). */
    timeoutMs: z.number().int().min(1_000).max(600_000),
    /** Off: no request verifies certificates, whatever its own setting says. */
    verifyTls: z.boolean(),
    /** Off: no request follows redirects, whatever its own setting says. */
    followRedirects: z.boolean(),
    maxResponseMb: z.number().int().min(1).max(500),
    /** Adds Cache-Control: no-cache unless the request already sets Cache-Control. */
    sendNoCache: z.boolean(),
  }),
  network: networkSchema,
  ui: z.object({
    splitPercent: z.number().int().min(SPLIT_MIN).max(SPLIT_MAX),
  }),
});
export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  editor: { fontSize: 12, tabSize: 2, closeBrackets: true },
  request: { timeoutMs: 30_000, verifyTls: true, followRedirects: true, maxResponseMb: 50, sendNoCache: false },
  network: { proxy: { mode: "none", server: "", username: "", bypass: "localhost, 127.0.0.1" }, caFile: null, clientCerts: [] },
  ui: { splitPercent: SPLIT_DEFAULT },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads stored preferences field by field: anything missing or invalid falls back to its default. */
export function readPrefs(raw: unknown): Prefs {
  const out = structuredClone(DEFAULT_PREFS);
  if (!isRecord(raw)) return out;
  const theme = prefsSchema.shape.theme.safeParse(raw["theme"]);
  if (theme.success) out.theme = theme.data;
  for (const group of ["editor", "request", "ui"] as const) {
    const stored = raw[group];
    if (!isRecord(stored)) continue;
    const shape = prefsSchema.shape[group].shape as Record<string, z.ZodType>;
    const target = out[group] as Record<string, unknown>;
    for (const [key, schema] of Object.entries(shape)) {
      const value = schema.safeParse(stored[key]);
      if (value.success) target[key] = value.data;
    }
  }
  const network = networkSchema.safeParse(raw["network"]);
  if (network.success) out.network = network.data;
  return out;
}

/** Every file path the network preferences point to. */
export function networkPaths(network: NetworkPrefs): string[] {
  return [network.caFile, ...network.clientCerts.flatMap((c) => [c.certFile, c.keyFile, c.pfxFile])].filter((p): p is string => p !== null);
}

/** host:port of a proxy server written as "host:port" or "http://host:port"; null when it is not valid. */
export function parseProxyServer(server: string): { host: string; port: number } | null {
  const text = server.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return url.hostname ? { host: url.hostname.replace(/^\[|\]$/g, ""), port } : null;
  } catch {
    return null;
  }
}

/** Whether a host skips the proxy: "*" for all, exact names, "*.domain" or ".domain" for subdomains. */
export function bypassesProxy(hostname: string, bypass: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return bypass
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      if (entry.startsWith("*.")) return host.endsWith(entry.slice(1));
      if (entry.startsWith(".")) return host === entry.slice(1) || host.endsWith(entry);
      return host === entry;
    });
}

/** The client certificate configured for a URL's host and port (443/80 by default), if any. */
export function clientCertFor(url: string, certs: readonly ClientCert[]): ClientCert | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const port = parsed.port || "443";
  const host = parsed.hostname.toLowerCase();
  return (
    certs.find((c) => {
      const [h, p] = c.host.trim().toLowerCase().split(/:(?=\d+$)/);
      return h === host && (p ?? "443") === port;
    }) ?? null
  );
}

/** The request as main sends it: global switches can only turn verification and redirects off. */
export function applyRequestPrefs(request: HttpRequest, prefs: Prefs["request"]): HttpRequest {
  const settings = {
    ...request.settings,
    verifyTls: request.settings.verifyTls && prefs.verifyTls,
    followRedirects: request.settings.followRedirects && prefs.followRedirects,
  };
  const hasCacheControl = request.headers.some((h) => h.enabled && h.key.trim().toLowerCase() === "cache-control");
  const headers = prefs.sendNoCache && !hasCacheControl ? [...request.headers, { key: "Cache-Control", value: "no-cache", enabled: true }] : request.headers;
  return { ...request, settings, headers };
}

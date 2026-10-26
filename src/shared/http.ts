/**
 * HTTP request and response as they cross from the UI to the engine and back.
 * The query string lives in `url`; the UI keeps its parameter table in sync with it.
 */
import { z } from "zod";

export const keyValueSchema = z.object({
  key: z.string().max(8_192),
  value: z.string().max(1_048_576),
  enabled: z.boolean(),
  description: z.string().max(2_048).optional(),
});
export type KeyValue = z.infer<typeof keyValueSchema>;

export const RAW_LANGUAGES = ["json", "text", "xml", "html", "javascript"] as const;
export type RawLanguage = (typeof RAW_LANGUAGES)[number];

export const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("raw"), language: z.enum(RAW_LANGUAGES), raw: z.string().max(52_428_800) }),
  z.object({ mode: z.literal("urlencoded"), fields: z.array(keyValueSchema).max(1_000) }),
  z.object({ mode: z.literal("formdata"), fields: z.array(keyValueSchema).max(1_000) }),
  /** A v2.1 body Sendix cannot edit yet (file, GraphQL, form-data with files…): kept and sent as-is. */
  z.object({ mode: z.literal("preserved"), label: z.string().max(64), data: z.unknown() }),
]);
export type RequestBody = z.infer<typeof bodySchema>;
export type BodyMode = RequestBody["mode"];

export const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  /** Use the auth of the enclosing folder or collection (v2.1: no `auth` on the item). */
  z.object({ type: z.literal("inherit") }),
  z.object({ type: z.literal("bearer"), token: z.string().max(65_536) }),
  z.object({ type: z.literal("basic"), username: z.string().max(4_096), password: z.string().max(4_096) }),
  z.object({ type: z.literal("apikey"), key: z.string().max(1_024), value: z.string().max(65_536), in: z.enum(["header", "query"]) }),
  /** A v2.1 auth Sendix cannot edit yet (OAuth 2.0, Digest, AWS…): kept and sent as-is. */
  z.object({ type: z.literal("preserved"), label: z.string().max(64), data: z.unknown() }),
]);
export type RequestAuth = z.infer<typeof authSchema>;
export type AuthType = RequestAuth["type"];

/**
 * Optional request behaviours saved in the item's v2.1 `protocolProfileBehavior`.
 * Missing means "inherit": the folders and the collection may set them, otherwise
 * postman-runtime's default applies.
 */
export const BEHAVIOR_KEYS = ["maxRedirects", "followOriginalHttpMethod", "followAuthorizationHeader", "removeRefererHeaderOnRedirect", "disableUrlEncoding", "disableCookies"] as const;
export type BehaviorKey = (typeof BEHAVIOR_KEYS)[number];

export const settingsSchema = z.object({
  /** 1 s to 10 min. */
  timeoutMs: z.number().int().min(1_000).max(600_000),
  followRedirects: z.boolean(),
  verifyTls: z.boolean(),
  maxRedirects: z.number().int().min(0).max(100).optional(),
  /** Redirect with the original method instead of GET. */
  followOriginalHttpMethod: z.boolean().optional(),
  /** Keep the Authorization header when a redirect goes to another host. */
  followAuthorizationHeader: z.boolean().optional(),
  removeRefererHeaderOnRedirect: z.boolean().optional(),
  /** Send the URL exactly as written, without percent-encoding it. */
  disableUrlEncoding: z.boolean().optional(),
  /** Neither send nor store cookies for this request. */
  disableCookies: z.boolean().optional(),
});
export type RequestSettings = z.infer<typeof settingsSchema>;

/** The protocolProfileBehavior keys a request's own settings set (inherited ones stay out). */
export function behaviorOf(settings: RequestSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of BEHAVIOR_KEYS) if (settings[key] !== undefined) out[key] = settings[key];
  return out;
}

export const DEFAULT_SETTINGS: RequestSettings = { timeoutMs: 30_000, followRedirects: true, verifyTls: true };

/** Pre-request and post-response (test) scripts, as JavaScript text. */
export const scriptsSchema = z.object({
  prerequest: z.string().max(1_048_576),
  test: z.string().max(1_048_576),
});
export type RequestScripts = z.infer<typeof scriptsSchema>;
export const EMPTY_SCRIPTS: RequestScripts = { prerequest: "", test: "" };

export const httpRequestSchema = z.object({
  method: z.string().regex(/^[A-Za-z][A-Za-z-]{0,23}$/),
  /** May be empty while a saved request is being written. */
  url: z.string().max(65_536),
  headers: z.array(keyValueSchema).max(500),
  body: bodySchema,
  auth: authSchema,
  settings: settingsSchema,
  /** Optional so requests stored before scripts existed (history) still parse. */
  scripts: scriptsSchema.optional(),
});
export type HttpRequest = z.infer<typeof httpRequestSchema>;

const ms = z.number().min(0);

/** Phases of the final hop, plus the time spent in earlier redirect hops. */
export const timingsSchema = z.object({
  dns: ms,
  tcp: ms,
  tls: ms,
  /** Time to first byte once the connection is ready. */
  wait: ms,
  download: ms,
  redirects: ms,
  total: ms,
});
export type Timings = z.infer<typeof timingsSchema>;

export const headerSchema = z.object({ key: z.string(), value: z.string() });
export type Header = z.infer<typeof headerSchema>;

export const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().nullable(),
  path: z.string().nullable(),
  expires: z.string().nullable(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
});
export type Cookie = z.infer<typeof cookieSchema>;

export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

export const httpResponseSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.array(headerSchema),
  cookies: z.array(cookieSchema),
  body: z.instanceof(Uint8Array),
  sizes: z.object({ body: z.number().int().min(0), headers: z.number().int().min(0) }),
  timings: timingsSchema,
  redirectCount: z.number().int().min(0),
  /** What actually went on the wire for the final hop (system headers included). */
  sent: z.object({ method: z.string(), url: z.string(), headers: z.array(headerSchema) }),
});
export type HttpResponse = z.infer<typeof httpResponseSchema>;

export const testResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  skipped: z.boolean(),
  error: z.string().nullable(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const consoleEntrySchema = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  text: z.string(),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

/** What the scripts did during a send. Secret values are masked in every string. */
export const scriptReportSchema = z.object({
  tests: z.array(testResultSchema),
  console: z.array(consoleEntrySchema),
  /** Uncaught errors in a script, by phase. */
  errors: z.array(z.object({ phase: z.enum(["prerequest", "test"]), message: z.string() })),
});
export type ScriptReport = z.infer<typeof scriptReportSchema>;

const variableChangeSchema = z.object({ key: z.string(), value: z.string().nullable() });
/**
 * Variables the scripts set or unset. Main keeps them as session values and
 * strips this field before the outcome reaches the renderer (it may hold secrets).
 */
export const sessionChangesSchema = z.object({
  environment: z.array(variableChangeSchema),
  collection: z.array(variableChangeSchema),
});
export type SessionChanges = z.infer<typeof sessionChangesSchema>;

const scriptFields = { scripts: scriptReportSchema.optional(), session: sessionChangesSchema.optional() };

export const httpOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("response"), response: httpResponseSchema, ...scriptFields }),
  z.object({ kind: z.literal("error"), code: z.string(), message: z.string(), elapsedMs: ms, ...scriptFields }),
  z.object({ kind: z.literal("cancelled"), elapsedMs: ms, ...scriptFields }),
]);
export type HttpOutcome = z.infer<typeof httpOutcomeSchema>;

export const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const variableSchema = z.object({
  key: z.string().max(1_024),
  value: z.string().max(1_048_576),
  enabled: z.boolean(),
  /** Secret values are masked in console output and test messages. */
  secret: z.boolean().optional(),
});
export type Variable = z.infer<typeof variableSchema>;

/**
 * Where a request sits when it runs: inherited auth (collection first, then each
 * folder; null = that level sets none), collection variables and the active
 * environment. Built by main from the workspace, never taken from the renderer.
 */
export const sendContextSchema = z.object({
  authChain: z.array(z.record(z.string(), z.unknown()).nullable()).max(64),
  /** Scripts of the collection, then of each folder (v2.1 `event` arrays; null where a level has none). */
  eventChain: z.array(z.array(z.record(z.string(), z.unknown())).nullable()).max(64),
  collectionVariables: z.array(variableSchema).max(5_000),
  environment: z.array(variableSchema).max(5_000),
  /** protocolProfileBehavior of the collection, then of each folder (null where a level has none). */
  behaviorChain: z.array(z.record(z.string(), z.unknown()).nullable()).max(64).optional(),
});
export type SendContext = z.infer<typeof sendContextSchema>;

/** Proxy and certificates for one send, worked out by main from Settings (files read in main). */
export const networkOptionsSchema = z.object({
  proxy: z
    .object({ host: z.string().min(1).max(256), port: z.number().int().min(1).max(65_535), username: z.string().max(256), password: z.string().max(4_096) })
    .nullable(),
  /** Extra CA in PEM, trusted on top of the system's. */
  ca: z.string().max(1_048_576).nullable(),
  /** Client certificate for this URL: PEM cert and key, or a PFX in base64. */
  cert: z
    .object({
      match: z.string().min(1).max(512),
      cert: z.string().max(1_048_576).optional(),
      key: z.string().max(1_048_576).optional(),
      pfx: z.string().max(4_194_304).optional(),
      passphrase: z.string().max(4_096).optional(),
    })
    .nullable(),
});
export type NetworkOptions = z.infer<typeof networkOptionsSchema>;

/** A request saved in a workspace collection. */
export const requestSourceSchema = z.object({ collectionId: z.string().min(1).max(128), itemId: z.string().min(1).max(128) });
export type RequestSource = z.infer<typeof requestSourceSchema>;

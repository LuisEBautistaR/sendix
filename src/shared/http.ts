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

export const settingsSchema = z.object({
  /** 1 s to 10 min. */
  timeoutMs: z.number().int().min(1_000).max(600_000),
  followRedirects: z.boolean(),
  verifyTls: z.boolean(),
});
export type RequestSettings = z.infer<typeof settingsSchema>;

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
});
export type SendContext = z.infer<typeof sendContextSchema>;

/** A request saved in a workspace collection. */
export const requestSourceSchema = z.object({ collectionId: z.string().min(1).max(128), itemId: z.string().min(1).max(128) });
export type RequestSource = z.infer<typeof requestSourceSchema>;

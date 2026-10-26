/**
 * Pure conversions between Sendix's request model and the Postman Collection v2.1
 * item format that postman-runtime executes, plus helpers that read its results.
 */
import { behaviorOf, type Cookie, type HttpRequest, type KeyValue, type RawLanguage, type SendContext, type Timings } from "@shared/http";
import { scriptsToEvents } from "@shared/collection";

const CONTENT_TYPES: Record<RawLanguage, string> = {
  json: "application/json",
  text: "text/plain",
  xml: "application/xml",
  html: "text/html",
  javascript: "application/javascript",
};

const enabled = (rows: readonly KeyValue[]) => rows.filter((r) => r.enabled && r.key.trim() !== "");
const hasHeader = (rows: readonly KeyValue[], name: string) =>
  enabled(rows).some((r) => r.key.trim().toLowerCase() === name.toLowerCase());

/** Collection v2.1 item for one request. `userAgent` is used only when the user set none. */
export function toCollectionItem(request: HttpRequest, userAgent: string): Record<string, unknown> {
  const header = enabled(request.headers).map((h) => ({ key: h.key.trim(), value: h.value }));
  if (!hasHeader(request.headers, "user-agent")) header.push({ key: "User-Agent", value: userAgent });

  let body: Record<string, unknown> | undefined;
  switch (request.body.mode) {
    case "raw":
      body = { mode: "raw", raw: request.body.raw, options: { raw: { language: request.body.language } } };
      if (!hasHeader(request.headers, "content-type")) {
        header.push({ key: "Content-Type", value: CONTENT_TYPES[request.body.language] });
      }
      break;
    case "urlencoded":
      body = { mode: "urlencoded", urlencoded: enabled(request.body.fields).map((f) => ({ key: f.key, value: f.value })) };
      break;
    case "formdata":
      body = { mode: "formdata", formdata: enabled(request.body.fields).map((f) => ({ key: f.key, value: f.value, type: "text" })) };
      break;
    case "preserved":
      if (request.body.data && typeof request.body.data === "object") body = request.body.data as Record<string, unknown>;
      break;
    case "none":
      break;
  }

  let auth: Record<string, unknown> | undefined;
  switch (request.auth.type) {
    case "bearer":
      auth = { type: "bearer", bearer: [{ key: "token", value: request.auth.token, type: "string" }] };
      break;
    case "basic":
      auth = {
        type: "basic",
        basic: [
          { key: "username", value: request.auth.username, type: "string" },
          { key: "password", value: request.auth.password, type: "string" },
        ],
      };
      break;
    case "apikey":
      auth = {
        type: "apikey",
        apikey: [
          { key: "key", value: request.auth.key, type: "string" },
          { key: "value", value: request.auth.value, type: "string" },
          { key: "in", value: request.auth.in, type: "string" },
        ],
      };
      break;
    case "none":
      auth = { type: "noauth" };
      break;
    case "preserved":
      if (request.auth.data && typeof request.auth.data === "object") auth = request.auth.data as Record<string, unknown>;
      break;
    case "inherit":
      // No auth on the item: postman-runtime walks up to the folder and collection.
      break;
  }

  const event = request.scripts ? scriptsToEvents([], request.scripts) : [];
  // The item's own behaviour; turning TLS checks or redirects off here also beats folders and collection.
  const behavior: Record<string, unknown> = behaviorOf(request.settings);
  if (!request.settings.verifyTls) behavior["strictSSL"] = false;
  if (!request.settings.followRedirects) behavior["followRedirects"] = false;
  return {
    name: "Sendix request",
    request: { method: request.method.toUpperCase(), url: request.url, header, ...(body ? { body } : {}), ...(auth ? { auth } : {}) },
    ...(event.length ? { event } : {}),
    ...(Object.keys(behavior).length ? { protocolProfileBehavior: behavior } : {}),
  };
}

/**
 * Wraps the item in the collection and folders it belongs to, so postman-runtime
 * applies inherited auth and collection variables exactly as in the original file.
 */
export function toCollection(item: Record<string, unknown>, context: SendContext | null): Record<string, unknown> {
  if (!context) return { item: [item] };
  const [collectionAuth = null, ...folderAuths] = context.authChain;
  const [collectionEvents = null, ...folderEvents] = context.eventChain;
  // postman-runtime resolves protocolProfileBehavior from the item up through folders and collection.
  const [collectionBehavior = null, ...folderBehaviors] = context.behaviorChain ?? [];
  let node: Record<string, unknown> = item;
  for (let i = Math.max(folderAuths.length, folderEvents.length, folderBehaviors.length) - 1; i >= 0; i--) {
    const auth = folderAuths[i];
    const event = folderEvents[i];
    const behavior = folderBehaviors[i];
    node = { name: `folder-${i}`, item: [node], ...(auth ? { auth } : {}), ...(event ? { event } : {}), ...(behavior ? { protocolProfileBehavior: behavior } : {}) };
  }
  return {
    item: [node],
    variable: context.collectionVariables.map((v) => ({ key: v.key, value: v.value, disabled: !v.enabled })),
    ...(collectionAuth ? { auth: collectionAuth } : {}),
    ...(collectionEvents ? { event: collectionEvents } : {}),
    ...(collectionBehavior ? { protocolProfileBehavior: collectionBehavior } : {}),
  };
}

/** Offsets (ms from run start) postman-runtime records for each hop of a request. */
export interface HopOffsets {
  request?: number;
  socket?: number;
  lookup?: number;
  connect?: number;
  secureConnect?: number;
  response?: number;
  end?: number;
}

const span = (from: number | undefined, to: number | undefined) =>
  from === undefined || to === undefined ? 0 : Math.max(0, to - from);
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Phases of the final hop; earlier hops (redirects) are summed into `redirects`.
 * On a reused keep-alive socket dns/tcp/tls are 0 because the offsets coincide.
 */
export function computeTimings(hops: readonly (HopOffsets | undefined)[], fallbackTotal: number): Timings {
  const last = hops.at(-1);
  const first = hops[0];
  if (!last || last.response === undefined || last.end === undefined) {
    return { dns: 0, tcp: 0, tls: 0, wait: Math.max(0, fallbackTotal), download: 0, redirects: 0, total: Math.max(0, fallbackTotal) };
  }
  const socket = last.socket ?? last.request;
  const lookup = last.lookup ?? socket;
  const connect = last.connect ?? lookup;
  const ready = last.secureConnect ?? connect;
  return {
    dns: round(span(socket, lookup)),
    tcp: round(span(lookup, connect)),
    tls: round(last.secureConnect === undefined ? 0 : span(connect, last.secureConnect)),
    wait: round(span(ready, last.response)),
    download: round(span(last.response, last.end)),
    redirects: round(hops.length > 1 ? span(first?.request, last.request) : 0),
    total: round(span(first?.request ?? last.request, last.end)),
  };
}

/** Cookies as postman-runtime hands them to the response callback. */
export function mapCookies(cookies: unknown): Cookie[] {
  // postman-runtime passes an SDK CookieList; plain arrays are accepted too.
  const list: unknown =
    cookies && typeof cookies === "object" && typeof (cookies as { toJSON?: unknown }).toJSON === "function"
      ? (cookies as { toJSON(): unknown }).toJSON()
      : cookies;
  if (!Array.isArray(list)) return [];
  return list.flatMap((c): Cookie[] => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    const name = typeof o["name"] === "string" ? o["name"] : typeof o["key"] === "string" ? o["key"] : null;
    if (name === null) return [];
    const expires = o["expires"];
    return [
      {
        name,
        value: typeof o["value"] === "string" ? o["value"] : "",
        domain: typeof o["domain"] === "string" ? o["domain"] : null,
        path: typeof o["path"] === "string" ? o["path"] : null,
        expires: expires instanceof Date ? expires.toISOString() : typeof expires === "string" ? expires : null,
        httpOnly: o["httpOnly"] === true,
        secure: o["secure"] === true,
      },
    ];
  });
}

/** Error codes from Node/postman-request that the UI explains in plain words. */
export function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && /maximum response size/i.test(message)) return "RESPONSE_TOO_LARGE";
  }
  return "REQUEST_FAILED";
}

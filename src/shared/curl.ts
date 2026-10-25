/**
 * Turns a pasted cURL command (bash or Windows cmd quoting) into a request.
 * Runs in the renderer: nothing is executed, the text is only tokenised.
 */
import { DEFAULT_SETTINGS, type HttpRequest, type KeyValue, type RequestBody } from "./http";

export interface CurlImport {
  request: HttpRequest;
  /** Things that could not be carried over, in plain words. */
  notes: string[];
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

/** Splits a shell command line into words, honouring quotes and line continuations. */
export function tokenize(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  const out: string[] = [];
  let word = "";
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      word += text.slice(i + 1, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
      inWord = true;
    } else if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\" || text[i + 1] === "$" || text[i + 1] === "`")) i++;
        word += text[i];
        i++;
      }
      inWord = true;
    } else if (ch === "\\" && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) out.push(word);
      word = "";
      inWord = false;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (inWord) out.push(word);
  return out;
}

const SKIP = new Set(["-s", "--silent", "-S", "--show-error", "-v", "--verbose", "-i", "--include", "--compressed", "-L", "--location", "-g", "--globoff", "-N", "--no-buffer"]);
const WITH_VALUE_IGNORED = new Set(["-o", "--output", "-w", "--write-out", "--connect-timeout", "--retry"]);

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function parseCurl(command: string): CurlImport | null {
  if (!looksLikeCurl(command)) return null;
  const words = tokenize(command.trim()).slice(1);
  const notes: string[] = [];
  let method: string | null = null;
  let url = "";
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const form: KeyValue[] = [];
  let user: string | null = null;
  let verifyTls = DEFAULT_SETTINGS.verifyTls;
  let timeoutMs = DEFAULT_SETTINGS.timeoutMs;
  let getWithData = false;
  let jsonFlag = false;

  for (let i = 0; i < words.length; i++) {
    let w = words[i]!;
    let inline: string | null = null;
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    if (eq > 0) {
      inline = w.slice(eq + 1);
      w = w.slice(0, eq);
    }
    const next = () => inline ?? words[++i] ?? "";
    // Short options may carry their value glued on: -XPOST, -HAccept:x
    const glued = /^-([XHdFuAbem])(.+)$/.exec(w);
    if (glued) {
      w = `-${glued[1]}`;
      inline = glued[2]!;
    }

    if (w === "-X" || w === "--request") method = next().toUpperCase();
    else if (w === "-H" || w === "--header") {
      const h = next();
      const colon = h.indexOf(":");
      if (colon > 0) headers.push({ key: h.slice(0, colon).trim(), value: h.slice(colon + 1).trim(), enabled: true });
    } else if (["-d", "--data", "--data-raw", "--data-ascii", "--data-binary"].includes(w)) {
      const d = next();
      if (d.startsWith("@") && w !== "--data-raw") notes.push(`El cuerpo venía de un archivo (${d.slice(1)}); añádelo a mano.`);
      else data.push(d);
    } else if (w === "--data-urlencode") {
      const d = next();
      const at = d.indexOf("=");
      data.push(at < 0 ? encodeURIComponent(d) : `${d.slice(0, at)}=${encodeURIComponent(d.slice(at + 1))}`);
    } else if (w === "--json") {
      data.push(next());
      jsonFlag = true;
    } else if (w === "-F" || w === "--form") {
      const f = next();
      const at = f.indexOf("=");
      const key = at < 0 ? f : f.slice(0, at);
      const value = at < 0 ? "" : f.slice(at + 1);
      if (value.startsWith("@")) notes.push(`El campo «${key}» enviaba un archivo; los archivos en form-data llegan más adelante.`);
      else form.push({ key, value, enabled: true });
    } else if (w === "-u" || w === "--user") user = next();
    else if (w === "-A" || w === "--user-agent") headers.push({ key: "User-Agent", value: next(), enabled: true });
    else if (w === "-b" || w === "--cookie") headers.push({ key: "Cookie", value: next(), enabled: true });
    else if (w === "-e" || w === "--referer") headers.push({ key: "Referer", value: next(), enabled: true });
    else if (w === "-k" || w === "--insecure") verifyTls = false;
    else if (w === "-G" || w === "--get") getWithData = true;
    else if (w === "-I" || w === "--head") method = "HEAD";
    else if (w === "-m" || w === "--max-time") timeoutMs = Math.min(600, Math.max(1, Math.round(Number(next()) || 30))) * 1000;
    else if (w === "--url") url = next();
    else if (SKIP.has(w)) continue;
    else if (WITH_VALUE_IGNORED.has(w)) next();
    else if (w.startsWith("-")) notes.push(`Se ignoró la opción ${w}.`);
    else if (!url) url = w;
  }

  if (!url) return null;
  const hasHeader = (name: string) => headers.some((h) => h.key.toLowerCase() === name);
  if (jsonFlag) {
    if (!hasHeader("content-type")) headers.push({ key: "Content-Type", value: "application/json", enabled: true });
    if (!hasHeader("accept")) headers.push({ key: "Accept", value: "application/json", enabled: true });
  }

  let body: RequestBody = { mode: "none" };
  const joined = data.join("&");
  if (data.length && getWithData) {
    url += (url.includes("?") ? "&" : "?") + joined;
  } else if (data.length) {
    const type = headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
    const trimmed = joined.trim();
    if (type.includes("json") || ((trimmed.startsWith("{") || trimmed.startsWith("[")) && !type)) {
      body = { mode: "raw", language: "json", raw: joined };
    } else if (type.includes("xml")) {
      body = { mode: "raw", language: "xml", raw: joined };
    } else if ((!type || type.includes("x-www-form-urlencoded")) && /^[^=&\s]+=/.test(trimmed)) {
      body = {
        mode: "urlencoded",
        fields: joined.split("&").map((pair) => {
          const at = pair.indexOf("=");
          return { key: decode(at < 0 ? pair : pair.slice(0, at)), value: decode(at < 0 ? "" : pair.slice(at + 1)), enabled: true };
        }),
      };
      // The body mode already sets this header.
      const ct = headers.findIndex((h) => h.key.toLowerCase() === "content-type");
      if (ct >= 0) headers.splice(ct, 1);
    } else {
      body = { mode: "raw", language: "text", raw: joined };
    }
  } else if (form.length) {
    body = { mode: "formdata", fields: form };
  }

  let auth: HttpRequest["auth"] = { type: "none" };
  if (user !== null) {
    const colon = user.indexOf(":");
    auth = { type: "basic", username: colon < 0 ? user : user.slice(0, colon), password: colon < 0 ? "" : user.slice(colon + 1) };
  }
  const bearer = headers.findIndex((h) => h.key.toLowerCase() === "authorization" && /^bearer\s+/i.test(h.value));
  if (bearer >= 0 && auth.type === "none") {
    auth = { type: "bearer", token: headers[bearer]!.value.replace(/^bearer\s+/i, "") };
    headers.splice(bearer, 1);
  }

  return {
    request: {
      method: method ?? (data.length && !getWithData ? "POST" : form.length ? "POST" : "GET"),
      url,
      headers,
      body,
      auth,
      settings: { ...DEFAULT_SETTINGS, verifyTls, timeoutMs },
    },
    notes,
  };
}

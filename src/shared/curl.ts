/**
 * Turns a pasted cURL command (bash, Windows cmd or PowerShell quoting) into a request.
 * Runs in the renderer: nothing is executed, the text is only tokenised.
 */
import { DEFAULT_SETTINGS, type HttpRequest, type KeyValue, type RequestBody } from "./http";

export interface CurlImport {
  request: HttpRequest;
  /** Things that could not be carried over, in plain words. */
  notes: string[];
}

/** Setup lines before a PowerShell command (Sendix writes $OutputEncoding; others use Legacy argument passing). */
const POWERSHELL_PREAMBLE = /^(\s*\$(OutputEncoding|PSNativeCommandArgumentPassing)\s*=[^\r\n;]*[\r\n;]+)+/i;
/**
 * cURL options in a literal here-string that then reaches curl as a config file
 * (`--config` or `-K`, from a temporary file or a pipe): how Sendix writes PowerShell commands.
 */
const POWERSHELL_CONFIG = /^\s*(?:\$\w+\s*=\s*)?@'\r?\n([^]*?)\r?\n'@[^]*?\bcurl(?:\.exe)?\s+(?:--config|-K)\s/i;

export function looksLikeCurl(text: string): boolean {
  const command = text.replace(POWERSHELL_PREAMBLE, "");
  return /^\s*curl(\.exe)?\s/i.test(command) || POWERSHELL_CONFIG.test(command);
}

export type CurlSyntax = "bash" | "cmd" | "powershell";

/** Which shell a command was written for, from its line continuations and quoting. */
export function detectSyntax(text: string): CurlSyntax {
  if (POWERSHELL_PREAMBLE.test(text) || POWERSHELL_CONFIG.test(text) || /`\r?\n/.test(text)) return "powershell";
  if (/\^\r?\n/.test(text) || /\^"/.test(text)) return "cmd";
  return "bash";
}

/** Splits a shell command line into words, honouring its shell's quotes and line continuations. */
export function tokenize(input: string, syntax: CurlSyntax = detectSyntax(input)): string[] {
  if (syntax === "cmd") return splitWindows(cmdToCommandLine(input));
  if (syntax === "powershell") {
    const config = POWERSHELL_CONFIG.exec(input.replace(POWERSHELL_PREAMBLE, ""));
    return config ? ["curl.exe", ...configArgs(config[1]!)] : tokenizePowerShell(input);
  }
  const text = input.replace(/\\\r?\n/g, " ");
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

/**
 * What cmd hands to curl.exe: outside cmd's own quotes a caret takes the next character
 * literally, and a caret at the end of a line joins the next one (escaping its first character).
 */
function cmdToCommandLine(text: string): string {
  let line = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      quoted = !quoted;
      line += ch;
    } else if (ch === "^" && !quoted && i + 1 < text.length) {
      i += text[i + 1] === "\r" && text[i + 2] === "\n" ? 2 : 1;
      if (text[i] === "\n") i++;
      if (i < text.length) line += text[i];
    } else line += ch;
  }
  return line;
}

/** Splits a command line the way Windows programs (MSVCRT, as curl.exe) read their arguments. */
function splitWindows(line: string): string[] {
  const out: string[] = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\") {
      let n = 0;
      while (line[i + n] === "\\") n++;
      if (line[i + n] === '"') {
        word += "\\".repeat(Math.floor(n / 2));
        if (n % 2) {
          word += '"';
          i += n;
        } else i += n - 1;
      } else {
        word += "\\".repeat(n);
        i += n - 1;
      }
      inWord = true;
    } else if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        word += '"';
        i++;
      } else quoted = !quoted;
      inWord = true;
    } else if (!quoted && /\s/.test(ch)) {
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

const CONFIG_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", v: "\v" };

/**
 * A cURL config file as command-line words: `name = "value"`, `name value` or a bare
 * `name` per line, # for comments, \\ \" \n \r \t \v inside double quotes.
 */
function configArgs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const name = /^[^\s=:]+/.exec(line)![0];
    out.push(name.startsWith("-") ? name : `--${name}`);
    let rest = line.slice(name.length).replace(/^\s*[=:]?\s*/, "");
    if (!rest) continue;
    if (rest.startsWith('"')) {
      let value = "";
      for (let i = 1; i < rest.length && rest[i] !== '"'; i++) {
        if (rest[i] === "\\" && i + 1 < rest.length) {
          const next = rest[++i]!;
          value += CONFIG_ESCAPES[next] ?? next;
        } else value += rest[i];
      }
      out.push(value);
    } else {
      rest = rest.split(/\s/)[0]!;
      out.push(rest);
    }
  }
  return out;
}

const BACKTICK: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0" };

/**
 * PowerShell quoting ('' inside single quotes, backtick escapes inside double quotes,
 * backtick line continuations), then the \" escapes curl.exe needs from PowerShell 5.1
 * or from 7 with Legacy argument passing.
 */
function tokenizePowerShell(input: string): string[] {
  const legacy = /^\s*\$PSNativeCommandArgumentPassing\s*=\s*['"]?Legacy/i.test(input);
  const text = input.replace(POWERSHELL_PREAMBLE, "");
  const out: string[] = [];
  let word = "";
  let inWord = false;
  const push = () => {
    if (inWord) out.push(fromLegacyArgument(word, legacy));
    word = "";
    inWord = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "`") {
      const next = text[i + 1];
      if (next === "\r" || next === "\n") {
        i += next === "\r" && text[i + 2] === "\n" ? 2 : 1;
        push();
      } else if (next !== undefined) {
        word += next;
        inWord = true;
        i++;
      }
    } else if (ch === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          word += "'";
          i += 2;
        } else if (text[i] === "'") break;
        else word += text[i++];
      }
      inWord = true;
    } else if (ch === '"') {
      i++;
      while (i < text.length && !(text[i] === '"' && text[i + 1] !== '"')) {
        if (text[i] === "`" && i + 1 < text.length) {
          word += BACKTICK[text[i + 1]!] ?? text[i + 1];
          i += 2;
        } else if (text[i] === '"') {
          word += '"';
          i += 2;
        } else word += text[i++];
      }
      inWord = true;
    } else if (/\s/.test(ch)) push();
    else {
      word += ch;
      inWord = true;
    }
  }
  push();
  return out;
}

/** Undoes the escaping an argument needs to reach curl.exe intact from PowerShell. */
function fromLegacyArgument(word: string, legacy: boolean): string {
  if (!legacy && !word.includes('\\"')) return word;
  let out = "";
  for (let i = 0; i < word.length; i++) {
    let n = 0;
    while (word[i + n] === "\\") n++;
    if (word[i + n] === '"' && (legacy || n % 2)) {
      out += "\\".repeat(Math.floor(n / 2)) + (n % 2 ? '"' : "");
      i += n;
    } else if (n) {
      // PowerShell wraps an argument with whitespace in quotes, so its trailing backslashes went doubled.
      out += "\\".repeat(legacy && i + n === word.length && /\s/.test(word) ? n / 2 : n);
      i += n - 1;
    } else out += word[i];
  }
  return out;
}

const SKIP = new Set(["-s", "--silent", "-S", "--show-error", "-v", "--verbose", "-i", "--include", "--compressed", "-L", "--location", "-g", "--globoff", "-N", "--no-buffer"]);
const WITH_VALUE_IGNORED = new Set(["-o", "--output", "-w", "--write-out", "--connect-timeout", "--retry", "-U", "--proxy-user", "--noproxy"]);
const CERT_OPTIONS = new Set(["-E", "--cert", "--key", "--cacert", "--capath", "--cert-type", "--key-type", "--pass"]);

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
  let userScheme: "basic" | "digest" | "ntlm" = "basic";
  let bearerToken: string | null = null;
  const query: string[] = [];
  let verifyTls = DEFAULT_SETTINGS.verifyTls;
  let timeoutMs = DEFAULT_SETTINGS.timeoutMs;
  let maxRedirects: number | undefined;
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
      // `X;` is how cURL sends a header with an empty value.
      else if (/^[^:;\s]+;$/.test(h.trim())) headers.push({ key: h.trim().slice(0, -1), value: "", enabled: true });
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
    } else if (w === "--form-string") {
      const f = next();
      const at = f.indexOf("=");
      form.push({ key: at < 0 ? f : f.slice(0, at), value: at < 0 ? "" : f.slice(at + 1), enabled: true });
    } else if (w === "-u" || w === "--user") user = next();
    else if (w === "--digest") userScheme = "digest";
    else if (w === "--ntlm") userScheme = "ntlm";
    else if (w === "--oauth2-bearer") bearerToken = next();
    else if (w === "-A" || w === "--user-agent") headers.push({ key: "User-Agent", value: next(), enabled: true });
    else if (w === "-b" || w === "--cookie") {
      const cookie = next();
      // Without "=" it names a cookie file.
      if (cookie.includes("=")) headers.push({ key: "Cookie", value: cookie, enabled: true });
      else notes.push(`Las cookies venían del archivo ${cookie}; añádelas a mano en Cabeceras.`);
    } else if (w === "-e" || w === "--referer") headers.push({ key: "Referer", value: next(), enabled: true });
    else if (w === "-k" || w === "--insecure") verifyTls = false;
    else if (w === "-G" || w === "--get") getWithData = true;
    else if (w === "-I" || w === "--head") method = "HEAD";
    else if (w === "-m" || w === "--max-time") timeoutMs = Math.min(600, Math.max(1, Math.round(Number(next()) || 30))) * 1000;
    else if (w === "--max-redirs") {
      const n = Number(next());
      if (Number.isInteger(n) && n >= 0 && n <= 100) maxRedirects = n;
    } else if (w === "--url") url = next();
    else if (w === "--url-query") query.push(next());
    else if (w === "-x" || w === "--proxy") {
      next();
      notes.push("El proxy no se guarda en la petición: configúralo en Ajustes → Red y certificados.");
    } else if (CERT_OPTIONS.has(w)) {
      next();
      notes.push(`Los certificados (${w}) no se guardan en la petición: añádelos en Ajustes → Red y certificados.`);
    } else if (SKIP.has(w)) continue;
    else if (WITH_VALUE_IGNORED.has(w)) next();
    else if (w.startsWith("-")) notes.push(`Se ignoró la opción ${w}.`);
    else if (!url) url = w;
  }

  if (!url) return null;
  if (query.length) url += (url.includes("?") ? "&" : "?") + query.join("&");
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
    const username = colon < 0 ? user : user.slice(0, colon);
    const password = colon < 0 ? "" : user.slice(colon + 1);
    if (userScheme === "basic") auth = { type: "basic", username, password };
    else {
      // Digest and NTLM are sent as v2.1 auth; Sendix does not edit them yet.
      const params = [
        { key: "username", value: username, type: "string" },
        { key: "password", value: password, type: "string" },
      ];
      auth = { type: "preserved", label: userScheme === "digest" ? "Digest" : "NTLM", data: { type: userScheme, [userScheme]: params } };
    }
  }
  if (bearerToken !== null && auth.type === "none") auth = { type: "bearer", token: bearerToken };
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
      settings: { ...DEFAULT_SETTINGS, verifyTls, timeoutMs, ...(maxRedirects !== undefined ? { maxRedirects } : {}) },
    },
    notes,
  };
}

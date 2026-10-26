/**
 * Turns a request into a cURL command for bash, Windows cmd or PowerShell.
 *
 * Main builds it, because only main knows inherited auth and secret values. Unless
 * the user asks for them, secrets stay out: secret variables are left as {{name}}
 * and credentials (auth fields, Authorization and Cookie headers) become placeholders.
 */
import { z } from "zod";
import { httpRequestSchema, requestSourceSchema, type HttpRequest, type KeyValue, type RawLanguage, type RequestAuth } from "./http";

export const CURL_SHELLS = ["bash", "cmd", "powershell"] as const;
export type CurlShell = (typeof CURL_SHELLS)[number];
export const CURL_SHELL_LABEL: Record<CurlShell, string> = { bash: "bash", cmd: "cmd", powershell: "PowerShell" };

export const curlOptionsSchema = z.object({
  shell: z.enum(CURL_SHELLS),
  /** Replace {{variables}} with their values (secret ones only with includeSecrets). */
  resolveVariables: z.boolean(),
  /** Copy secret variables and credentials as they are. */
  includeSecrets: z.boolean(),
});
export type CurlOptions = z.infer<typeof curlOptionsSchema>;

/** What the window asks main for: a preview, or the command copied to the clipboard. */
export const curlBuildSchema = z.object({
  request: httpRequestSchema,
  source: requestSourceSchema.nullable(),
  options: curlOptionsSchema,
  copy: z.boolean(),
});
export type CurlBuild = z.infer<typeof curlBuildSchema>;

export interface CurlVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean | undefined;
}

export interface CurlExport {
  command: string;
  /** What the command leaves out or changes, in plain words. */
  notes: string[];
}

/** Main's answer: always the command with secrets hidden, and whether it went to the clipboard. */
export type CurlBuildResult = (CurlExport & { copied: boolean }) | null;


const VAR = /\{\{([^{}]+)\}\}/g;
const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie"]);
const CONTENT_TYPES: Record<RawLanguage, string> = { json: "application/json", text: "text/plain", xml: "application/xml", html: "text/html", javascript: "application/javascript" };
const DEFAULT_TIMEOUT_MS = 30_000;

type Json = Record<string, unknown>;
/** One option: a flag alone, or a flag and its value. */
type Arg = [string] | [string, string];
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/** v2.1 auth parameters, as a list of {key, value} or as an object. */
function authParams(list: unknown): Record<string, string> {
  if (Array.isArray(list)) return Object.fromEntries(list.filter(isObject).map((p) => [str(p["key"]), str(p["value"])]));
  return isObject(list) ? Object.fromEntries(Object.entries(list).map(([k, v]) => [k, str(v)])) : {};
}

// ---------- quoting ----------

const BASH_SAFE = /^[A-Za-z0-9_\-.,:/@%+=]+$/;

function quoteBash(arg: string): string {
  return arg !== "" && BASH_SAFE.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** How a Windows program (MSVCRT rules, as curl.exe) needs an argument written to read it back exactly. */
function msvcrtQuoted(arg: string): string {
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") slashes++;
    else if (ch === '"') {
      out += `${"\\".repeat(slashes * 2 + 1)}"`;
      slashes = 0;
    } else {
      out += "\\".repeat(slashes) + ch;
      slashes = 0;
    }
  }
  return `${out}${"\\".repeat(slashes * 2)}"`;
}

/**
 * cmd, the hard way: every quote is written as ^" so cmd never enters its own quoting,
 * and every character cmd could act on gets a caret. A % before a name gets a caret
 * after it, so cmd finds no variable to expand. A line break is ^ plus two breaks.
 */
function caretQuoted(arg: string): string {
  const inner = msvcrtQuoted(arg).slice(1, -1);
  const escaped = inner
    .replace(/[^A-Za-z0-9 \t\r\n_\-:=+~'/.,?;*`%]/g, "^$&")
    .replace(/%(?=[A-Za-z0-9_])/g, "%^")
    .replace(/\r?\n/g, "^\n\n");
  return `^"${escaped}^"`;
}

// No * or ?: curl.exe may expand them as file wildcards unless they are quoted.
const CMD_BARE = /^[A-Za-z0-9_\-.:/@+~=,]+$/;

/**
 * cmd, the way people write it: bare when nothing needs quoting, otherwise in plain
 * double quotes (inside them cmd leaves & | < > ^ alone; inner quotes go as \").
 * cmd sees each \" as a quote too, so inner quotes must come in pairs (or cmd stays
 * "inside quotes" for the rest of the line) and must not leave & | < > ^ ! outside.
 * Anything else, and values with % or a line break, fall back to carets.
 */
function quoteCmd(arg: string): string {
  if (arg !== "" && CMD_BARE.test(arg)) return arg;
  const quotes = arg.split('"').length - 1;
  if (!/[%\r\n]/.test(arg) && (quotes === 0 || (quotes % 2 === 0 && !/[&|<>^!]/.test(arg)))) return msvcrtQuoted(arg);
  return caretQuoted(arg);
}

const QUOTE: Record<Exclude<CurlShell, "powershell">, (arg: string) => string> = { bash: quoteBash, cmd: quoteCmd };
/** bash goes one option per line; cmd on a single line, which pastes anywhere (caret line breaks do not). */
const CONTINUATION: Record<Exclude<CurlShell, "powershell">, string> = { bash: " \\\n  ", cmd: " " };

/**
 * PowerShell 5.1 mangles quotes in arguments for programs, and 7 does it differently,
 * so nothing goes as an argument: the options go to curl.exe in a config file. Not
 * through a pipe either: with the console in UTF-8, 5.1 puts a BOM in front of what it
 * pipes and curl rejects the first option. WriteAllText writes UTF-8 without one.
 */
export const POWERSHELL_HEAD = "$config = @'";
export const POWERSHELL_TAIL = ["'@", "$file = [IO.Path]::GetTempFileName()", "[IO.File]::WriteAllText($file, $config)", "try { curl.exe --config $file } finally { Remove-Item $file }"];

/** Config-file names of the short options Sendix writes. */
const LONG: Record<string, string> = { "-X": "request", "-H": "header", "-u": "user", "-L": "location", "-k": "insecure", "-F": "form", "-x": "proxy", "-U": "proxy-user" };

/** A value in a cURL config file: in double quotes, with \\ \" \n \r \t escapes. */
function configValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

function powerShellCommand(url: string, args: Arg[]): string {
  const lines = [`url = ${configValue(url)}`, ...args.map(([flag, value]) => {
    const name = LONG[flag] ?? flag.replace(/^--/, "");
    return value === undefined ? name : `${name} = ${configValue(value)}`;
  })];
  return [POWERSHELL_HEAD, ...lines, ...POWERSHELL_TAIL].join("\n");
}

// ---------- building ----------

/** Sendix's proxy setting (Ajustes → Red), so the command goes out the same way. */
export interface CurlProxy {
  mode: "none" | "system" | "custom";
  server: string;
  username: string;
  bypass: string;
}

function proxyArgs(proxy: CurlProxy | undefined, notes: Set<string>): Arg[] {
  if (!proxy) return [];
  // Sendix goes direct; without this curl would take HTTP(S)_PROXY from the environment.
  if (proxy.mode === "none") return [["--noproxy", "*"]];
  if (proxy.mode === "system") {
    notes.add("Sendix usa el proxy de Windows, que cURL no lee: si hace falta, añade -x servidor:puerto.");
    return [];
  }
  const server = proxy.server.trim();
  if (!server) return [];
  const args: Arg[] = [["-x", /^[a-z][a-z0-9+.-]*:\/\//i.test(server) ? server : `http://${server}`]];
  // curl matches a name and its subdomains; it has no *.domain form.
  const bypass = proxy.bypass
    .split(",")
    .map((h) => h.trim().replace(/^\*\./, "."))
    .filter(Boolean)
    .join(",");
  if (bypass) args.push(["--noproxy", bypass]);
  if (proxy.username.trim()) {
    args.push(["-U", proxy.username.trim()]);
    notes.add("cURL pedirá la contraseña del proxy al ejecutarlo.");
  }
  return args;
}

/** A JSON body on one line, for cmd; null when it is not valid JSON. */
function compactJson(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return null;
  }
}

class Builder {
  readonly notes = new Set<string>();
  readonly #vars = new Map<string, CurlVariable>();
  readonly #hidden = new Set<string>();
  readonly #undefined = new Set<string>();
  #dynamic = false;

  constructor(
    variables: readonly CurlVariable[],
    private readonly options: CurlOptions,
  ) {
    // Later lists win: the caller passes collection variables first, then the environment.
    for (const v of variables) if (v.enabled && v.key) this.#vars.set(v.key, v);
  }

  /** Replaces {{variables}} as the options say. */
  resolve(text: string, depth = 0): string {
    return text.replace(VAR, (whole, raw: string) => {
      const key = raw.trim();
      if (key.startsWith("$")) {
        this.#dynamic = true;
        return whole;
      }
      if (!this.options.resolveVariables) return whole;
      const found = this.#vars.get(key);
      if (!found) {
        this.#undefined.add(key);
        return whole;
      }
      if (found.secret && !this.options.includeSecrets) {
        this.#hidden.add(`{{${key}}}`);
        return whole;
      }
      return depth < 5 ? this.resolve(found.value, depth + 1) : found.value;
    });
  }

  /** A credential: as it is with includeSecrets, otherwise its {{variable}} or a placeholder. */
  secret(text: string, placeholder: string): string {
    if (this.options.includeSecrets) return this.resolve(text);
    if (text === "") return "";
    const shown = /^\{\{[^{}]+\}\}$/.test(text.trim()) ? text.trim() : placeholder;
    this.#hidden.add(shown);
    return shown;
  }

  finish(): string[] {
    const notes = [...this.notes];
    if (this.#hidden.size) notes.unshift(`No se copian los secretos (${[...this.#hidden].join(", ")}): activa «Incluir secretos» si los necesitas.`);
    if (this.#undefined.size) notes.push(`Sin valor en el entorno activo: ${[...this.#undefined].map((k) => `{{${k}}}`).join(", ")}.`);
    if (this.#dynamic) notes.push("Las variables dinámicas como {{$guid}} se dejan escritas: cURL no las entiende.");
    return notes;
  }
}

function authArgs(auth: RequestAuth, b: Builder, url: { value: string }): Arg[] {
  switch (auth.type) {
    case "none":
      return [];
    case "inherit":
      b.notes.add("La autorización heredada de la carpeta o la colección no se incluye.");
      return [];
    case "bearer":
      return [["-H", `Authorization: Bearer ${b.secret(auth.token, "<token>")}`]];
    case "basic":
      return [["-u", `${b.resolve(auth.username)}:${b.secret(auth.password, "<contraseña>")}`]];
    case "apikey": {
      const key = b.resolve(auth.key);
      const value = b.secret(auth.value, "<clave>");
      if (!key) return [];
      if (auth.in === "header") return [["-H", `${key}: ${value}`]];
      url.value += `${url.value.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${value.startsWith("<") || value.startsWith("{{") ? value : encodeURIComponent(value)}`;
      return [];
    }
    case "preserved": {
      const data = isObject(auth.data) ? auth.data : {};
      const type = str(data["type"]);
      if (type === "digest" || type === "ntlm") {
        const p = authParams(data[type]);
        return [[`--${type}`], ["-u", `${b.resolve(p["username"] ?? "")}:${b.secret(p["password"] ?? "", "<contraseña>")}`]];
      }
      b.notes.add(`La autorización ${auth.label} no se puede escribir en cURL: añádela a mano.`);
      return [];
    }
  }
}

function bodyArgs(request: HttpRequest, b: Builder, contentType: (value: string) => void): Arg[] {
  const body = request.body;
  const fields = (list: readonly KeyValue[]) => list.filter((f) => f.enabled && f.key.trim());
  switch (body.mode) {
    case "none":
      return [];
    case "raw":
      if (body.raw === "") return [];
      contentType(CONTENT_TYPES[body.language]);
      return [["--data-raw", b.resolve(body.raw)]];
    case "urlencoded":
      return fields(body.fields).map((f): Arg => ["--data-urlencode", `${b.resolve(f.key)}=${b.resolve(f.value)}`]);
    case "formdata":
      return fields(body.fields).map((f): Arg => ["--form-string", `${b.resolve(f.key)}=${b.resolve(f.value)}`]);
    case "preserved": {
      const data = isObject(body.data) ? body.data : {};
      const mode = str(data["mode"]);
      if (mode === "graphql" && isObject(data["graphql"])) {
        const g = data["graphql"];
        let variables: unknown = {};
        try {
          variables = typeof g["variables"] === "string" && g["variables"].trim() ? JSON.parse(g["variables"]) : {};
        } catch {
          b.notes.add("Las variables de GraphQL no son JSON válido y se dejaron fuera.");
        }
        contentType("application/json");
        return [["--data-raw", b.resolve(JSON.stringify({ query: str(g["query"]), variables }))]];
      }
      if (mode === "file" && isObject(data["file"]) && str(data["file"]["src"])) {
        b.notes.add("El cuerpo es un archivo de este equipo: la ruta solo sirve aquí.");
        return [["--data-binary", `@${str(data["file"]["src"])}`]];
      }
      if (mode === "formdata" && Array.isArray(data["formdata"])) {
        const args: Arg[] = [];
        for (const f of data["formdata"].filter(isObject)) {
          if (f["disabled"] === true || !str(f["key"])) continue;
          if (f["type"] === "file") {
            const src = Array.isArray(f["src"]) ? str(f["src"][0]) : str(f["src"]);
            if (src) args.push(["-F", `${b.resolve(str(f["key"]))}=@${src}`]);
          } else args.push(["--form-string", `${b.resolve(str(f["key"]))}=${b.resolve(str(f["value"]))}`]);
        }
        b.notes.add("Los archivos de form-data son rutas de este equipo: solo sirven aquí.");
        return args;
      }
      b.notes.add(`El cuerpo (${body.label}) no se puede escribir en cURL.`);
      return [];
    }
  }
}

export function requestToCurl(request: HttpRequest, variables: readonly CurlVariable[], options: CurlOptions, proxy?: CurlProxy): CurlExport {
  const b = new Builder(variables, options);
  const url = { value: b.resolve(request.url.trim()) };
  const auth = authArgs(request.auth, b, url);

  const headers: Arg[] = [];
  const named = new Set<string>();
  for (const h of request.headers) {
    const key = b.resolve(h.key.trim());
    if (!h.enabled || !key) continue;
    named.add(key.toLowerCase());
    const value = SENSITIVE_HEADERS.has(key.toLowerCase()) ? b.secret(h.value, "<oculto>") : b.resolve(h.value);
    // `X:` would remove the header in cURL; `X;` sends it empty.
    headers.push(["-H", value === "" ? `${key};` : `${key}: ${value}`]);
  }
  const body = bodyArgs(request, b, (type) => {
    if (!named.has("content-type")) headers.push(["-H", `Content-Type: ${type}`]);
  });

  const method = request.method.toUpperCase();
  // The method is checked against /^[A-Za-z-]+$/ before it gets here: no quoting needed.
  const methodArgs: Arg[] = method === "HEAD" ? [["--head"]] : (method === "GET" && !body.length) || (method === "POST" && body.length) ? [] : [["-X", method]];

  const settings: Arg[] = [];
  if (request.settings.followRedirects) settings.push(["-L"]);
  if (request.settings.followRedirects && request.settings.maxRedirects !== undefined) settings.push(["--max-redirs", String(request.settings.maxRedirects)]);
  if (!request.settings.verifyTls) settings.push(["-k"]);
  if (request.settings.timeoutMs !== DEFAULT_TIMEOUT_MS) settings.push(["--max-time", String(Math.round(request.settings.timeoutMs / 1000))]);
  settings.push(...proxyArgs(proxy, b.notes));

  // cmd cannot take a line break inside a pasted value, so JSON goes compacted.
  if (options.shell === "cmd" && request.body.mode === "raw" && request.body.language === "json") {
    const data = body.find((arg) => arg[0] === "--data-raw");
    const compact = data?.[1]?.includes("\n") ? compactJson(data[1]) : null;
    if (data && compact !== null) {
      data[1] = compact;
      b.notes.add("El JSON va en una sola línea para que cmd lo acepte: los datos son los mismos.");
    }
  }

  if (request.scripts && (request.scripts.prerequest.trim() || request.scripts.test.trim())) b.notes.add("Los scripts no se incluyen: cURL solo envía la petición.");

  const args = [...auth, ...headers, ...body, ...settings];
  if (options.shell === "cmd" && args.some(([, value]) => value !== undefined && /[\r\n]/.test(value))) {
    b.notes.add("Un valor tiene saltos de línea, así que en cmd el comando ocupa varias líneas: pégalo entero en una ventana de cmd.");
  }
  // curl.exe reads its arguments in the Windows code page; the PowerShell config file goes as UTF-8.
  // Sendix's own placeholders (<contraseña>) do not count.
  const sent = [url.value, ...args.flat()].join("").replace(/<(token|contraseña|clave|oculto)>/g, "");
  if (options.shell !== "powershell" && /[^\x00-\x7f]/.test(sent)) {
    b.notes.add("Lleva caracteres fuera de ASCII (acentos, ñ…): en Windows, curl puede enviarlos en otra codificación. Comprueba el resultado.");
  }
  if (options.shell === "powershell") return { command: powerShellCommand(url.value, [...methodArgs, ...args]), notes: b.finish() };
  const q = QUOTE[options.shell];
  const first = ["curl", ...methodArgs.flat(), q(url.value)].join(" ");
  const lines = [first, ...args.map(([flag, value]) => (value === undefined ? flag : `${flag} ${q(value)}`))];
  return { command: lines.join(CONTINUATION[options.shell]), notes: b.finish() };
}

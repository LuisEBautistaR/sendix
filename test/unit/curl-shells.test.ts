/**
 * Runs the commands «Copiar como cURL» writes in the real shells of this machine
 * (cmd, Windows PowerShell and Git Bash, when present) against a local server, and
 * checks that every awkward character arrives exactly as it was in the request.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type HttpRequest } from "@shared/http";
import { requestToCurl, type CurlShell } from "@shared/curl-export";

const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find((p) => existsSync(p));
// ASCII only: curl.exe on Windows re-encodes accents in arguments itself (Sendix warns about it).
const NASTY = `Ana "la jefa" O'Brien & 100% {"a":"x\\"y","ruta":"C:\\\\datos\\\\"} $HOME %PATH% %% ^caret <tag> | \`tick\` ; !hola! (a=b)`;

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let base = "";
const seen: Seen[] = [];
const dir = mkdtempSync(join(tmpdir(), "sendix-curl-shells-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

function run(file: string, args: string[], input?: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => resolve({ code, out }));
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Runs the command as a person would paste it into that shell. */
async function execute(shell: CurlShell, command: string) {
  if (shell === "cmd") {
    // Piped into cmd it behaves as typed at the prompt (not as a .cmd file, where % means something else).
    // The inner cmd starts after chcp, so it reads the pasted UTF-8 as such.
    return run("cmd.exe", ["/d", "/q", "/c", "chcp 65001 >nul & cmd.exe /d /q /k"], `${command}\r\nexit\r\n`);
  }
  if (shell === "powershell") {
    const file = join(dir, "pegado.ps1");
    writeFileSync(file, `\uFEFF${command}\r\n`, "utf8");
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file]);
  }
  const file = join(dir, "pegado.sh");
  writeFileSync(file, `${command}\n`, "utf8");
  return run(GIT_BASH!, [file]);
}

const shells: CurlShell[] = ["cmd", "powershell", ...(GIT_BASH ? (["bash"] as const) : [])];

describe.skipIf(process.platform !== "win32")("cURL commands in real shells", () => {
  it.each(shells)("%s sends the request exactly as it is in Sendix", async (shell) => {
    const request: HttpRequest = {
      method: "PUT",
      url: `${base}/eco/${shell}?filtro=a%20b&x=${encodeURIComponent("n&=")}`,
      headers: [
        { key: "X-Nota", value: NASTY, enabled: true },
        { key: "X-Vacia", value: "", enabled: true },
      ],
      body: { mode: "raw", language: "json", raw: `{\n  "nota": ${JSON.stringify(NASTY)},\n  "lineas": "uno\\ndos"\n}\n` },
      auth: { type: "basic", username: "ana", password: `p'w"\\ %x%` },
      settings: { ...DEFAULT_SETTINGS },
    };
    const { command } = requestToCurl(request, [], { shell, resolveVariables: true, includeSecrets: true });
    const before = seen.length;
    const result = await execute(shell, command);
    expect(seen.length, `${shell} no llegó al servidor:\n${result.out}`).toBe(before + 1);
    const got = seen.at(-1)!;
    expect(got.method).toBe("PUT");
    expect(got.url).toBe(`/eco/${shell}?filtro=a%20b&x=${encodeURIComponent("n&=")}`);
    expect(got.headers["x-nota"]).toBe(NASTY);
    expect(got.headers["x-vacia"]).toBe("");
    expect(got.headers["content-type"]).toBe("application/json");
    expect(got.headers["authorization"]).toBe(`Basic ${Buffer.from(`ana:p'w"\\ %x%`).toString("base64")}`);
    const raw = (request.body as { raw: string }).raw;
    // cmd gets the JSON on one line: the same data.
    expect(got.body).toBe(shell === "cmd" ? JSON.stringify(JSON.parse(raw)) : raw);
  }, 30_000);

  it("cmd gets a plain one-line command, as written by hand, that goes out without a proxy", async () => {
    const request: HttpRequest = {
      method: "POST",
      url: `${base}/eco/token`,
      headers: [{ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true }],
      body: { mode: "urlencoded", fields: [{ key: "grant_type", value: "client_credentials", enabled: true }] },
      auth: { type: "basic", username: "cliente-demo", password: "secreto-demo" },
      settings: { ...DEFAULT_SETTINGS, verifyTls: false, followRedirects: false },
    };
    const proxy = { mode: "none" as const, server: "", username: "", bypass: "" };
    const { command } = requestToCurl(request, [], { shell: "cmd", resolveVariables: true, includeSecrets: true }, proxy);
    expect(command).toBe(
      `curl ${base}/eco/token -u cliente-demo:secreto-demo -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode grant_type=client_credentials -k --noproxy "*"`,
    );
    const before = seen.length;
    const result = await execute("cmd", command);
    expect(seen.length, result.out).toBe(before + 1);
    const got = seen.at(-1)!;
    expect(got.method).toBe("POST");
    expect(got.headers["authorization"]).toBe(`Basic ${Buffer.from("cliente-demo:secreto-demo").toString("base64")}`);
    expect(got.body).toBe("grant_type=client_credentials");
  }, 30_000);

  it("PowerShell sends accents as UTF-8, through its config file", async () => {
    const text = "Señora Núñez, café ✓";
    const request: HttpRequest = {
      method: "POST",
      url: `${base}/eco/acentos`,
      headers: [{ key: "X-Nota", value: text, enabled: true }],
      body: { mode: "raw", language: "text", raw: text },
      auth: { type: "none" },
      settings: { ...DEFAULT_SETTINGS },
    };
    const { command, notes } = requestToCurl(request, [], { shell: "powershell", resolveVariables: true, includeSecrets: false });
    expect(notes.join(" ")).not.toContain("ASCII");
    const before = seen.length;
    const result = await execute("powershell", command);
    expect(seen.length, result.out).toBe(before + 1);
    const got = seen.at(-1)!;
    // Node reads header bytes as latin1: turn them back into the UTF-8 that was sent.
    expect(Buffer.from(String(got.headers["x-nota"]), "latin1").toString("utf8")).toBe(text);
    expect(got.body).toBe(text);
  }, 30_000);
});

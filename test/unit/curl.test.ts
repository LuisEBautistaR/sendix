import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type HttpRequest } from "@shared/http";
import { CURL_SHELLS, POWERSHELL_HEAD, POWERSHELL_TAIL, requestToCurl, type CurlOptions, type CurlShell, type CurlVariable } from "@shared/curl-export";
import { detectSyntax, parseCurl, tokenize } from "@shared/curl";

const request = (over: Partial<HttpRequest> = {}): HttpRequest => ({
  method: "GET",
  url: "https://api.tienda.test/v1/productos",
  headers: [],
  body: { mode: "none" },
  auth: { type: "none" },
  settings: { ...DEFAULT_SETTINGS },
  ...over,
});
const opts = (shell: CurlShell = "bash", over: Partial<CurlOptions> = {}): CurlOptions => ({ shell, resolveVariables: true, includeSecrets: false, ...over });

const vars: CurlVariable[] = [
  { key: "base", value: "https://dev.tienda.test", enabled: true },
  { key: "token", value: "tok-secreto-123", enabled: true, secret: true },
  { key: "cliente", value: "cli_204", enabled: true },
];

/** Strange values every shell must carry through untouched. */
const NASTY = `Ana "la jefa" O'Brien & 100% {"a":"x\\"y","ruta":"C:\\\\datos\\\\"} $HOME %PATH% ^caret <tag> | \`tick\` ;`;

describe("requestToCurl", () => {
  it("writes a JSON POST for bash with -L, its Content-Type and secrets hidden", () => {
    const out = requestToCurl(
      request({
        method: "POST",
        url: "{{base}}/v1/pedidos",
        headers: [{ key: "X-Cliente", value: "{{cliente}}", enabled: true }, { key: "X-Apagada", value: "no", enabled: false }],
        body: { mode: "raw", language: "json", raw: '{ "producto": "p1" }' },
        auth: { type: "bearer", token: "{{token}}" },
      }),
      vars,
      opts(),
    );
    expect(out.command).toBe(
      [
        "curl https://dev.tienda.test/v1/pedidos \\",
        "  -H 'Authorization: Bearer {{token}}' \\",
        "  -H 'X-Cliente: cli_204' \\",
        "  -H 'Content-Type: application/json' \\",
        `  --data-raw '{ "producto": "p1" }' \\`,
        "  -L",
      ].join("\n"),
    );
    expect(out.notes[0]).toContain("{{token}}");
  });

  it("copies secrets only when asked, and can keep every {{variable}}", () => {
    const r = request({ url: "{{base}}/yo", auth: { type: "bearer", token: "{{token}}" }, headers: [{ key: "Cookie", value: "sesion=abc", enabled: true }] });
    const withSecrets = requestToCurl(r, vars, opts("bash", { includeSecrets: true }));
    expect(withSecrets.command).toContain("Authorization: Bearer tok-secreto-123");
    expect(withSecrets.command).toContain("Cookie: sesion=abc");
    expect(withSecrets.notes).toEqual([]);

    const hidden = requestToCurl(r, vars, opts());
    expect(hidden.command).toContain("'Cookie: <oculto>'");
    expect(hidden.command).not.toContain("abc");

    const kept = requestToCurl(r, vars, opts("bash", { resolveVariables: false }));
    expect(kept.command).toContain("curl '{{base}}/yo'");
  });

  it("hides literal credentials and explains what it leaves out", () => {
    const out = requestToCurl(
      request({
        url: "{{base}}/x?id={{$guid}}",
        auth: { type: "basic", username: "ana", password: "pw-real" },
        scripts: { prerequest: "pm.variables.set('a', 1)", test: "" },
        headers: [{ key: "X-Falta", value: "{{noexiste}}", enabled: true }],
      }),
      vars,
      opts(),
    );
    expect(out.command).toContain("-u 'ana:<contraseña>'");
    expect(out.command).not.toContain("pw-real");
    expect(out.notes.join(" ")).toMatch(/scripts/);
    expect(out.notes.join(" ")).toContain("{{noexiste}}");
    expect(out.notes.join(" ")).toContain("{{$guid}}");
    // Its own placeholder <contraseña> is not a reason to warn about accents.
    expect(out.notes.join(" ")).not.toContain("ASCII");
  });

  it("writes forms, the method, TLS, redirects and timeout", () => {
    const form = requestToCurl(
      request({ method: "PUT", body: { mode: "urlencoded", fields: [{ key: "q", value: "café con leche", enabled: true }] }, settings: { ...DEFAULT_SETTINGS, verifyTls: false, timeoutMs: 5_000, maxRedirects: 3 } }),
      [],
      opts(),
    );
    expect(form.command).toContain("curl -X PUT ");
    expect(form.command).toContain("--data-urlencode 'q=café con leche'");
    expect(form.command).toContain("--max-redirs 3");
    expect(form.command).toContain("-k");
    expect(form.command).toContain("--max-time 5");
    expect(form.notes.join(" ")).toContain("fuera de ASCII");

    const multipart = requestToCurl(request({ method: "POST", body: { mode: "formdata", fields: [{ key: "foto", value: "@no-es-un-archivo", enabled: true }] } }), [], opts());
    expect(multipart.command).toContain("--form-string foto=@no-es-un-archivo");

    const head = requestToCurl(request({ method: "HEAD", settings: { ...DEFAULT_SETTINGS, followRedirects: false } }), [], opts());
    expect(head.command).toBe("curl --head https://api.tienda.test/v1/productos");
  });

  it("writes Digest and API key auth, and says when an auth cannot be written", () => {
    const digest = requestToCurl(
      request({ auth: { type: "preserved", label: "Digest", data: { type: "digest", digest: [{ key: "username", value: "ana" }, { key: "password", value: "pw" }] } } }),
      [],
      opts("bash", { includeSecrets: true }),
    );
    expect(digest.command).toContain("--digest \\\n  -u ana:pw");

    const query = requestToCurl(request({ auth: { type: "apikey", key: "api_key", value: "k 1", in: "query" } }), [], opts("bash", { includeSecrets: true }));
    expect(query.command).toContain("curl 'https://api.tienda.test/v1/productos?api_key=k%201'");

    const oauth = requestToCurl(request({ auth: { type: "preserved", label: "OAuth 2.0", data: { type: "oauth2" } } }), [], opts());
    expect(oauth.notes.join(" ")).toContain("OAuth 2.0");
  });

  it("hands PowerShell's options to curl.exe as a config file, out of reach of its quoting", () => {
    const out = requestToCurl(request({ method: "DELETE", headers: [{ key: "X-Nota", value: 'dice "hola"\ty \\ adiós\n', enabled: true }] }), [], opts("powershell"));
    expect(out.command).toBe(
      [POWERSHELL_HEAD, 'url = "https://api.tienda.test/v1/productos"', 'request = "DELETE"', 'header = "X-Nota: dice \\"hola\\"\\ty \\\\ adiós\\n"', "location", ...POWERSHELL_TAIL].join("\n"),
    );
  });

  it.each(CURL_SHELLS)("round-trips a request with awkward values through %s", (shell) => {
    const original = request({
      method: "PATCH",
      url: "https://api.tienda.test/v1/clientes/7?filtro=a%20b&x=1",
      headers: [
        { key: "X-Nota", value: NASTY, enabled: true },
        { key: "X-Vacia", value: "", enabled: true },
      ],
      body: { mode: "raw", language: "json", raw: `{\n  "nota": ${JSON.stringify(NASTY)},\n  "lineas": "uno\\ndos"\n}\n` },
      auth: { type: "basic", username: "ana", password: `p'w"\\` },
      settings: { ...DEFAULT_SETTINGS, verifyTls: false },
    });
    const { command } = requestToCurl(original, [], opts(shell, { includeSecrets: true }));
    expect(detectSyntax(command)).toBe(shell);
    const back = parseCurl(command)!;
    expect(back.notes).toEqual([]);
    expect(back.request).toMatchObject({
      method: "PATCH",
      url: original.url,
      headers: [
        { key: "X-Nota", value: NASTY.trim(), enabled: true },
        { key: "X-Vacia", value: "", enabled: true },
        { key: "Content-Type", value: "application/json", enabled: true },
      ],
      body: original.body,
      auth: original.auth,
      settings: { verifyTls: false },
    });
  });
});

describe("importing cURL", () => {
  it("reads Chrome's «Copy as cURL (cmd)» quoting", () => {
    const cmd = `curl ^"https://a.test/buscar?q=1^&r=2^" ^\n  -H ^"accept: application/json^" ^\n  --data-raw ^"^{^\\^"nombre^\\^":^\\^"Ana 100^%^\\^"^}^"`;
    expect(detectSyntax(cmd)).toBe("cmd");
    expect(tokenize(cmd)).toEqual(["curl", "https://a.test/buscar?q=1&r=2", "-H", "accept: application/json", "--data-raw", '{"nombre":"Ana 100%"}']);
  });

  it("reads PowerShell commands written for 5.1 and for 7", () => {
    expect(tokenize("curl.exe -H 'A: b' -d '{\\\"a\\\": 1}' `\n  https://a.test", "powershell")).toEqual(["curl.exe", "-H", "A: b", "-d", '{"a": 1}', "https://a.test"]);
    expect(tokenize(`curl.exe -d '{"a": "it''s"}' https://a.test`, "powershell")).toEqual(["curl.exe", "-d", `{"a": "it's"}`, "https://a.test"]);
  });

  it("brings Digest, --oauth2-bearer, --max-redirs and --url-query, and explains proxies and certificates", () => {
    const digest = parseCurl("curl --digest -u ana:pw --max-redirs 4 --url-query 'q=x' https://a.test/p")!;
    expect(digest.request.auth).toEqual({ type: "preserved", label: "Digest", data: { type: "digest", digest: [{ key: "username", value: "ana", type: "string" }, { key: "password", value: "pw", type: "string" }] } });
    expect(digest.request.settings.maxRedirects).toBe(4);
    expect(digest.request.url).toBe("https://a.test/p?q=x");

    const bearer = parseCurl("curl --oauth2-bearer abc https://a.test")!;
    expect(bearer.request.auth).toEqual({ type: "bearer", token: "abc" });

    const extra = parseCurl("curl -x http://proxy:8080 --cert yo.pem -b cookies.txt https://a.test")!;
    expect(extra.notes).toHaveLength(3);
    expect(extra.notes.join(" ")).toContain("Ajustes");
    expect(extra.request.headers).toEqual([]);
  });
});

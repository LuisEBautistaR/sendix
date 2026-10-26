/** M2: workspace folders, collections on disk, environments with secrets, imports and cURL paste. */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, root, shots, type Launched } from "./app";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
let s: Launched;
let dir: string;

/** Makes the next OS file/folder picker return `path` without showing it. */
async function pick(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);
}

const collectionFile = () => join(dir, "collections", readdirSync(join(dir, "collections")).find((f) => f.startsWith("Tienda"))!);

async function openWorkspace(win: Page) {
  await pick(s.app, dir);
  await win.getByTestId("open-workspace").click();
  await expect(win.getByTestId("tree")).toContainText("Tienda demo");
}

async function openRequest(win: Page, name: string) {
  const folder = win.getByTestId("tree-folder").filter({ hasText: "Productos" });
  if (!(await win.getByTestId("tree-request").filter({ hasText: name }).isVisible())) await folder.locator(".tree-main").click();
  await win.getByTestId("tree-request").filter({ hasText: name }).locator(".tree-main").click();
}

test.beforeAll(async () => {
  server = await startTestServer();
});
test.afterAll(async () => server.close());
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sendix-ws-e2e-"));
  mkdirSync(join(dir, "collections"));
  // The fixture, pointed at the local test server and at /echo so we can see what was sent.
  const fixture = JSON.parse(readFileSync(resolve(root, "test/fixtures/tienda.postman_collection.json"), "utf8"));
  fixture.variable[0].value = server.url;
  fixture.item[0].item[0].request.url = { raw: "{{base}}/echo?categoria={{categoria}}", host: ["{{base}}"], path: ["echo"], query: [{ key: "categoria", value: "{{categoria}}" }, { key: "pagina", value: "2", disabled: true }] };
  writeFileSync(join(dir, "collections", "Tienda.postman_collection.json"), JSON.stringify(fixture, null, 2));
  s = await launch();
  s.win.on("dialog", (d) => void d.accept());
});
test.afterEach(async () => {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
});

test("opens a folder and sends with inherited auth and an encrypted secret", async () => {
  const { win } = s;
  await expect(win.getByText("Abre una carpeta de trabajo")).toBeVisible();
  await win.screenshot({ path: resolve(shots, "workspace-empty.png") });
  await openWorkspace(win);

  // Environment with a secret used by the folder's API-key auth.
  await win.getByTestId("rail-environments").click();
  await win.getByTestId("new-environment").click();
  await win.getByTestId("environment-name").fill("Desarrollo");
  await win.getByTestId("env-key-0").fill("clave");
  await win.getByTestId("env-secret-0").check();
  await win.getByTestId("env-value-0").fill("k-secreta-123");
  await win.getByTestId("env-key-1").fill("categoria");
  await win.getByTestId("env-value-1").fill("te");
  await win.screenshot({ path: resolve(shots, "environment-editor.png") });
  await win.getByTestId("environment-save").click();
  await win.getByTestId("environment-select").selectOption({ label: "Desarrollo" });

  const envFile = readdirSync(join(dir, "environments"))[0]!;
  const onDisk = readFileSync(join(dir, "environments", envFile), "utf8");
  expect(onDisk).not.toContain("k-secreta-123");
  expect(JSON.parse(onDisk).values[0]).toMatchObject({ key: "clave", type: "secret", value: "" });

  await win.getByTestId("rail-collections").click();
  await openRequest(win, "Listar productos");
  await expect(win.getByTestId("breadcrumb")).toContainText("Tienda demo / Productos / Listar productos");
  await expect(win.locator(".url-layer .var").first()).toHaveText("{{base}}");
  await expect(win.locator(".url-layer .var.missing")).toHaveCount(0);
  await expect(win.getByTestId("params-key-1")).toHaveValue("pagina");

  await win.getByTestId("send").click();
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  const body = win.getByTestId("response-body");
  await expect(body).toContainText('"x-clave": "k-secreta-123"'); // folder auth wins over the collection's bearer
  await expect(body).not.toContainText("authorization");
  await expect(body).toContainText('"categoria": "te"'); // environment overrides the collection variable
  await win.screenshot({ path: resolve(shots, "workspace-light.png") });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(400); // let colour transitions finish before the capture
  await win.getByTestId("item-menu").count();
  await win.getByTestId("tree-request").filter({ hasText: "Listar productos" }).hover();
  await win.getByRole("button", { name: "Acciones de Listar productos" }).click();
  await win.screenshot({ path: resolve(shots, "workspace-dark.png") });
  await win.keyboard.press("Escape");
  await win.emulateMedia({ colorScheme: "light" });

  // History never keeps the resolved secret.
  const history = await win.evaluate(() => window.sendix.history.list());
  expect(JSON.stringify(history)).not.toContain("k-secreta-123");
});

test("edits a saved request and writes only that change to disk", async () => {
  const { win } = s;
  await openWorkspace(win);
  await openRequest(win, "Listar productos");
  await win.getByTestId("method").selectOption("POST");
  await expect(win.locator(".tab .x.dirty")).toBeVisible();
  await win.keyboard.press("Control+s");
  await expect(win.locator(".tab .x.dirty")).toHaveCount(0);

  const saved = JSON.parse(readFileSync(collectionFile(), "utf8"));
  const item = saved.item[0].item[0];
  expect(item.request.method).toBe("POST");
  expect(item.event[0].listen).toBe("test");
  expect(item.response).toHaveLength(1);
  expect(item.request.url.query[1]).toMatchObject({ key: "pagina", disabled: true });
  await expect(win.getByTestId("tree-request").filter({ hasText: "Listar productos" })).toContainText("POST");
});

test("saves a scratch request into a collection folder", async () => {
  const { win } = s;
  await openWorkspace(win);
  await win.getByTestId("url").fill(`${server.url}/json`);
  await win.keyboard.press("Control+s");
  await expect(win.getByTestId("save-dialog")).toBeVisible();
  await win.getByTestId("save-name").fill("Salud del servidor");
  await win.getByTestId("save-folder").selectOption({ label: "Productos" });
  await win.getByTestId("save-confirm").click();
  await expect(win.getByTestId("save-dialog")).toBeHidden();
  await expect(win.getByTestId("breadcrumb")).toContainText("Productos / Salud del servidor");

  const saved = JSON.parse(readFileSync(collectionFile(), "utf8"));
  expect(saved.item[0].item.map((i: { name: string }) => i.name)).toContain("Salud del servidor");
});

test("imports an OpenAPI definition and pastes a curl command", async () => {
  const { win, app } = s;
  await openWorkspace(win);
  const spec = join(dir, "..", `tienda-openapi-${Date.now()}.yaml`);
  writeFileSync(
    spec,
    ["openapi: 3.0.0", "info: { title: Inventario, version: '1' }", "paths:", "  /stock:", "    get: { summary: Ver stock, tags: [Stock], responses: { '200': { description: ok } } }"].join("\n"),
  );
  try {
    await pick(app, spec);
    await win.getByTestId("import").click();
    await win.getByTestId("import-file").click();
    await expect(win.getByTestId("tree")).toContainText("Inventario");
    await expect(win.getByTestId("toast").first()).toContainText("Importado «Inventario»: 1 peticiones");
  } finally {
    rmSync(spec, { force: true });
  }

  await win.getByTestId("new-tab").click();
  await win.getByTestId("url").focus();
  await win.evaluate((cmd) => {
    const dt = new DataTransfer();
    dt.setData("text", cmd);
    document.querySelector('[data-testid="url"]')!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, `curl -X POST '${server.url}/echo' -H 'Content-Type: application/json' --data-raw '{"a":1}' -u ana:pw`);
  await expect(win.getByTestId("url")).toHaveValue(`${server.url}/echo`);
  await expect(win.getByTestId("method")).toHaveValue("POST");
  await win.getByTestId("send").click();
  const body = win.getByTestId("response-body");
  await expect(body).toContainText('"method": "POST"');
  await expect(body).toContainText('"authorization": "Basic YW5hOnB3"');
  await expect(body).toContainText('"body": "{\\"a\\":1}"');
});

test("copies a saved request as cURL with its inherited auth, hiding the secret unless asked", async () => {
  const { win, app } = s;
  await openWorkspace(win);
  await win.getByTestId("rail-environments").click();
  await win.getByTestId("new-environment").click();
  await win.getByTestId("environment-name").fill("Desarrollo");
  await win.getByTestId("env-key-0").fill("clave");
  await win.getByTestId("env-secret-0").check();
  await win.getByTestId("env-value-0").fill("k-secreta-123");
  await win.getByTestId("env-key-1").fill("categoria");
  await win.getByTestId("env-value-1").fill("te");
  await win.getByTestId("environment-save").click();
  await win.getByTestId("environment-select").selectOption({ label: "Desarrollo" });
  await win.getByTestId("rail-collections").click();

  // From the request's menu in the tree.
  const folder = win.getByTestId("tree-folder").filter({ hasText: "Productos" });
  if (!(await win.getByTestId("tree-request").filter({ hasText: "Listar productos" }).isVisible())) await folder.locator(".tree-main").click();
  await win.getByTestId("tree-request").filter({ hasText: "Listar productos" }).hover();
  await win.getByRole("button", { name: "Acciones de Listar productos" }).click();
  await win.getByRole("menuitem", { name: "Copiar como cURL" }).click();
  const dialog = win.getByTestId("curl-dialog");
  await expect(dialog).toBeVisible();
  await win.getByTestId("curl-shell-bash").click();
  const preview = win.getByTestId("curl-preview");
  await expect(preview).toContainText(`curl '${server.url}/echo?categoria=te'`);
  await expect(preview).toContainText("-H 'X-Clave: {{clave}}'"); // the folder's API key, its secret left out
  await expect(preview).not.toContainText("k-secreta-123");
  await expect(win.getByTestId("curl-notes")).toContainText("{{clave}}");
  await expect(win.getByTestId("curl-notes")).toContainText("scripts");
  await win.screenshot({ path: resolve(shots, "curl-dialog.png") });
  await win.getByTestId("curl-copy").click();
  await expect(dialog).toBeHidden();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toBe([`curl '${server.url}/echo?categoria=te' \\`, "  -H 'X-Clave: {{clave}}' \\", "  -H 'Accept: application/json' \\", "  -L \\", "  --noproxy '*'"].join("\n"));

  // From the request line, with secrets: they reach the clipboard but never the window.
  await win.getByTestId("copy-curl").click();
  await expect(dialog).toBeVisible();
  await expect(win.getByTestId("curl-secrets")).not.toBeChecked();
  await win.getByTestId("curl-secrets").check(); // the confirmation is accepted by the dialog handler
  await expect(preview).not.toContainText("k-secreta-123");
  await win.getByTestId("curl-shell-powershell").click();
  await expect(preview).toContainText("curl.exe --config $file");
  await win.getByTestId("curl-copy").click();
  const withSecret = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(withSecret).toContain('header = "X-Clave: k-secreta-123"');
  expect(await win.locator("body").innerText()).not.toContain("k-secreta-123");
  await app.evaluate(({ clipboard }) => clipboard.clear());
});

test("imports a cURL command copied from the browser for cmd, from the Import menu", async () => {
  const { win } = s;
  await openWorkspace(win);
  await win.getByTestId("import").click();
  await win.getByTestId("import-curl").click();
  await expect(win.getByTestId("curl-import-dialog")).toBeVisible();
  const cmd = [`curl ^"${server.url}/echo?q=1^&r=2^" ^`, `  -H ^"accept: application/json^" ^`, `  --data-raw ^"^{^\\^"nombre^\\^":^\\^"Ana 100^%^\\^"^}^"`].join("\n");
  await win.getByTestId("curl-import-text").fill(cmd);
  await win.getByTestId("curl-import-open").click();
  await expect(win.getByTestId("curl-import-dialog")).toBeHidden();
  await expect(win.getByTestId("url")).toHaveValue(`${server.url}/echo?q=1&r=2`);
  await expect(win.getByTestId("method")).toHaveValue("POST");
  await win.getByTestId("send").click();
  const body = win.getByTestId("response-body");
  await expect(body).toContainText('"accept": "application/json"');
  await expect(body).toContainText('"body": "{\\"nombre\\":\\"Ana 100%\\"}"');
});

test("shows and edits the scripts, variables and auth of the collection and its folders", async () => {
  const { win } = s;
  await openWorkspace(win);

  // The collection has a script and variables: its row says so and opens them.
  await win.getByTestId("collection-flag").click();
  await expect(win.getByTestId("folder-name")).toHaveText("Tienda demo");
  await expect(win.getByTestId("script-prerequest")).toContainText("// script de la colección");

  await win.getByTestId("folder-tab-variables").click();
  await expect(win.getByTestId("folder-var-key-1")).toHaveValue("categoria");
  await win.getByTestId("folder-var-value-1").fill("infusion");
  await win.getByTestId("folder-var-key-3").fill("token");
  await win.getByTestId("folder-var-value-3").fill("tok-de-prueba");
  await win.getByTestId("folder-var-secret-3").check();
  await expect(win.getByTestId("folder-var-value-3")).toHaveAttribute("type", "password");
  await win.getByTestId("folder-var-reveal").check();
  await expect(win.getByTestId("folder-var-value-3")).toHaveAttribute("type", "text");
  await win.getByTestId("folder-var-search").fill("cat");
  await expect(win.getByTestId("folder-var-table").locator("tbody tr")).toHaveCount(1);
  await win.getByTestId("folder-var-search").fill("");
  await win.screenshot({ path: resolve(shots, "folder-variables.png") });
  await win.keyboard.press("Control+S");
  await expect(win.getByTestId("folder-save")).toBeDisabled();
  const saved = JSON.parse(readFileSync(collectionFile(), "utf8"));
  expect(saved.variable.slice(1)).toEqual([
    { key: "categoria", value: "infusion", type: "string" },
    { key: "viejo", value: "x", disabled: true },
    { key: "token", value: "tok-de-prueba", type: "secret" },
  ]);

  // A folder, from its menu: what it inherits, its auth and a new script.
  await win.getByTestId("tree-folder").filter({ hasText: "Productos" }).hover();
  await win.getByRole("button", { name: "Acciones de Productos" }).click();
  await win.getByRole("menuitem", { name: "Scripts y variables" }).click();
  await expect(win.getByTestId("folder-name")).toHaveText("Productos");
  await expect(win.getByTestId("folder-overview")).toContainText("Clave de API");
  await win.screenshot({ path: resolve(shots, "folder-overview.png") });
  await win.getByTestId("folder-tab-scripts").click();
  await expect(win.getByTestId("inherited-scripts")).toContainText("Tienda demo");
  await win.getByTestId("script-prerequest").click();
  await win.keyboard.insertText('pm.request.headers.add({ key: "X-Carpeta", value: pm.collectionVariables.get("categoria") });');
  await win.screenshot({ path: resolve(shots, "folder-scripts.png") });
  await win.getByTestId("folder-save").click();
  await expect(win.getByTestId("folder-save")).toBeDisabled();
  await expect(win.getByTestId("folder-flag")).toBeVisible();
  expect(JSON.parse(readFileSync(collectionFile(), "utf8")).item[0].event[0].script.exec[0]).toContain("X-Carpeta");

  // The request runs the folder's script after the collection's, and says so.
  await openRequest(win, "Listar productos");
  await win.getByTestId("send").click();
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await expect(win.getByTestId("response-body")).toContainText('"x-carpeta": "infusion"');
  await win.getByTestId("req-tab-scripts").click();
  const inherited = win.getByTestId("inherited-scripts");
  await expect(inherited).toContainText("Tienda demo");
  await expect(inherited).toContainText("Productos");
  await inherited.getByRole("button", { name: "Productos" }).click();
  await expect(win.getByTestId("folder-name")).toHaveText("Productos");
});

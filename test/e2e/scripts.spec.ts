/** M3: pre-request and test scripts, test results and console, session variables and the collection runner. */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, root, shots, type Launched } from "./app";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
let s: Launched;
let dir: string;

async function pick(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);
}

async function openWorkspace(win: Page) {
  await pick(s.app, dir);
  await win.getByTestId("open-workspace").click();
  await expect(win.getByTestId("tree")).toContainText("Tienda demo");
}

async function openRequest(win: Page, name: string) {
  const row = win.getByTestId("tree-request").filter({ hasText: name });
  if (!(await row.isVisible())) await win.getByTestId("tree-folder").filter({ hasText: "Productos" }).locator(".tree-main").click();
  await row.locator(".tree-main").click();
}

/** Replaces the code of the visible script editor. */
async function writeScript(win: Page, phase: "prerequest" | "test", code: string) {
  await win.getByTestId("req-tab-scripts").click();
  await win.getByTestId(`script-phase-${phase}`).click();
  const editor = win.getByTestId(`script-${phase}`);
  await editor.click();
  await win.keyboard.press("Control+A");
  await win.keyboard.press("Delete");
  await win.keyboard.insertText(code);
}

const collectionFile = () => join(dir, "collections", readdirSync(join(dir, "collections"))[0]!);

test.beforeAll(async () => {
  server = await startTestServer();
});
test.afterAll(async () => server.close());
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sendix-scripts-e2e-"));
  mkdirSync(join(dir, "collections"));
  const fixture = JSON.parse(readFileSync(resolve(root, "test/fixtures/tienda.postman_collection.json"), "utf8"));
  fixture.variable[0].value = server.url;
  fixture.item[0].item[0].request.url = "{{base}}/echo?categoria={{categoria}}";
  fixture.item[2].request.url = "{{base}}/json";
  writeFileSync(join(dir, "collections", "Tienda.postman_collection.json"), JSON.stringify(fixture, null, 2));
  s = await launch();
  s.win.on("dialog", (d) => void d.accept());
});
test.afterEach(async () => {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
});

test("test scripts report results and console, and pass values to the next request", async () => {
  const { win } = s;
  await openWorkspace(win);
  await openRequest(win, "Salud");
  await writeScript(
    win,
    "test",
    [
      'pm.test("El estado es 200", () => pm.response.to.have.status(200));',
      'pm.test("Tiene productos", () => pm.expect(pm.response.json().productos).to.have.length(2));',
      'pm.environment.set("primero", pm.response.json().productos[0].id);',
      'console.log("guardado", pm.environment.get("primero"));',
    ].join("\n"),
  );
  await expect(win.getByTestId("req-tab-scripts")).toContainText("1");
  // CodeMirror's styles load through constructed sheets inside its shadow root, under the production CSP.
  await expect(win.locator(".cm-gutters")).toHaveCSS("display", "flex");
  await expect(win.locator(".cm-scroller")).toHaveCSS("font-family", /JetBrains Mono/);

  await win.keyboard.press("Control+S");
  await expect.poll(() => JSON.parse(readFileSync(collectionFile(), "utf8")).item[2].event?.[0]?.script?.exec?.[2]).toBe('pm.environment.set("primero", pm.response.json().productos[0].id);');

  await win.getByTestId("send").click();
  await expect(win.getByTestId("tests-chip")).toHaveText("Tests 1/2");
  await win.getByTestId("res-tab-tests").click();
  await expect(win.getByTestId("test-row")).toHaveCount(2);
  await expect(win.getByTestId("test-row").nth(0)).toContainText("PASA");
  await expect(win.getByTestId("test-row").nth(1)).toContainText("FALLA");
  await expect(win.getByTestId("test-row").nth(1)).toContainText("expected");
  await expect(win.getByTestId("session-vars")).toBeVisible();
  await win.screenshot({ path: resolve(shots, "scripts-tests.png") });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(400); // let colour transitions finish before the capture
  await win.screenshot({ path: resolve(shots, "scripts-tests-dark.png") });
  await win.emulateMedia({ colorScheme: "light" });
  await win.getByTestId("res-tab-console").click();
  await expect(win.getByTestId("console")).toContainText("guardado prd_1");

  // The value set by the script resolves in another request for the rest of the session.
  await openRequest(win, "Listar productos");
  await win.getByTestId("url").fill("{{base}}/echo?p={{primero}}");
  await win.getByTestId("send").click();
  await expect(win.getByTestId("response-body")).toContainText('"p": "prd_1"');
  // The collection's own test script still runs.
  await expect(win.getByTestId("tests-chip")).toHaveText("Tests 1/1");

  await win.getByTestId("session-clear").click();
  await expect(win.getByTestId("session-vars")).toBeHidden();

  // A failing pre-request script stops the request.
  await writeScript(win, "prerequest", 'throw new Error("falta el token");');
  await win.screenshot({ path: resolve(shots, "scripts-editor.png") });
  await win.getByTestId("send").click();
  await expect(win.getByTestId("response-error")).toContainText("La petición no se envió");
  await expect(win.getByTestId("response-error")).toContainText("falta el token");
});

test("runs a collection with a CSV data file over two iterations", async () => {
  const { win } = s;
  await openWorkspace(win);
  await win.getByRole("button", { name: "Acciones de Tienda demo" }).click();
  await win.getByRole("menuitem", { name: "Ejecutar…" }).click();
  await expect(win.getByTestId("runner-plan").locator("li")).toHaveCount(4);

  await win.getByTestId("runner-data-input").setInputFiles({ name: "datos.csv", mimeType: "text/csv", buffer: Buffer.from("categoria,usuario\nte,ana\nchocolate,luis\n") });
  await expect(win.getByTestId("runner-data")).toContainText("2 filas");
  await expect(win.getByTestId("runner-iterations")).toHaveValue("2");
  await win.screenshot({ path: resolve(shots, "runner-plan.png") });

  await win.getByTestId("runner-start").click();
  await expect(win.getByTestId("runner-state")).toContainText("Terminada", { timeout: 30_000 });
  await expect(win.getByTestId("run-row")).toHaveCount(8);
  await expect(win.getByTestId("runner-summary")).toContainText("Tests 2/2");

  await win.getByTestId("run-row").nth(0).click();
  await expect(win.getByTestId("runner-results")).toContainText("categoria=te");
  await win.screenshot({ path: resolve(shots, "runner-results.png") });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(400); // let colour transitions finish before the capture
  await win.screenshot({ path: resolve(shots, "runner-results-dark.png") });
  await win.emulateMedia({ colorScheme: "light" });
  await win.getByTestId("run-row").nth(4).click();
  await expect(win.getByTestId("runner-results")).toContainText("categoria=chocolate");
});

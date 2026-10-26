/** 0.2 U3: runner — choose and order requests, options, cookies, run history, repeat and export. */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, shots, type Launched } from "./app";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
let s: Launched;
let dir: string;

const request = (name: string, url: string, test: string[] = []) => ({
  name,
  request: { method: "GET", url },
  event: test.length ? [{ listen: "test", script: { type: "text/javascript", exec: test } }] : [],
});

function collection(base: string) {
  return {
    info: { _postman_id: "c-runner", name: "Runner demo", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    variable: [{ key: "base", value: base }],
    item: [
      request("Login", "{{base}}/json", ['pm.collectionVariables.set("token", "tok-" + pm.response.json().total);', 'pm.test("Login 200", () => pm.response.to.have.status(200));']),
      request("Eco", "{{base}}/echo", ['pm.test("Eco 200", () => pm.response.to.have.status(200));']),
      request("Falla", "{{base}}/status/500", ['pm.test("Debe ser 200", () => pm.response.to.have.status(200));']),
      request("Final", "{{base}}/text"),
    ],
  };
}

async function pick(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);
}

async function openRunner(win: Page) {
  await pick(s.app, dir);
  await win.getByTestId("open-workspace").click();
  await expect(win.getByTestId("tree")).toContainText("Runner demo");
  await win.getByRole("button", { name: "Acciones de Runner demo" }).click();
  await win.getByRole("menuitem", { name: "Ejecutar…" }).click();
  await expect(win.getByTestId("plan-row")).toHaveCount(4);
}

const resultNames = (win: Page) => win.getByTestId("run-row").locator(".run-name > span:nth-child(3)").allTextContents();
const collectionFile = () => join(dir, "collections", readdirSync(join(dir, "collections"))[0]!);

async function run(win: Page, state = "Terminada") {
  await win.getByTestId("runner-start").click();
  await expect(win.getByTestId("runner-state")).toContainText(state, { timeout: 30_000 });
}

test.beforeAll(async () => {
  server = await startTestServer();
});
test.afterAll(async () => server.close());
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sendix-runner-e2e-"));
  mkdirSync(join(dir, "collections"));
  writeFileSync(join(dir, "collections", "Runner.postman_collection.json"), JSON.stringify(collection(server.url), null, 2));
  s = await launch();
  s.win.on("dialog", (d) => void d.accept());
});
test.afterEach(async () => {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
});

test("runs only the chosen requests, in the chosen order", async () => {
  const { win } = s;
  await openRunner(win);
  await win.getByRole("checkbox", { name: "Incluir Falla" }).uncheck();
  await win.getByRole("button", { name: "Subir Final" }).click();
  await win.getByRole("button", { name: "Subir Final" }).click();
  await win.getByRole("button", { name: "Subir Final" }).click();
  await expect(win.getByTestId("runner")).toContainText("3 de 4 peticiones");
  await win.screenshot({ path: resolve(shots, "runner-options-light.png") });
  await run(win);
  expect(await resultNames(win)).toEqual(["Final", "Login", "Eco"]);

  // Back to the settings: the choice is still there and can be reset.
  await win.getByTestId("runner-back").click();
  await win.getByTestId("runner-reset-order").click();
  await expect(win.getByTestId("plan-row").first()).toContainText("Login");
});

test("stops at the first failure and writes script variables to the collection", async () => {
  const { win } = s;
  await openRunner(win);
  await win.getByTestId("opt-stop-on-error").check();
  await win.getByTestId("opt-persist").check();
  await run(win, "Detenida en el primer fallo");
  expect(await resultNames(win)).toEqual(["Login", "Eco", "Falla"]);
  await expect(win.getByTestId("runner-persisted")).toHaveText("Se guardaron 1 variable en los archivos.");
  const saved = JSON.parse(readFileSync(collectionFile(), "utf8"));
  expect(saved.variable).toContainEqual({ key: "token", value: "tok-1" });
});

test("isolated cookies start empty; shared ones carry over from manual sends", async () => {
  const { win } = s;
  await openRunner(win);
  // A manual send stores the server's cookie in Sendix's jar.
  await win.getByTestId("tree-request").filter({ hasText: "Login" }).locator(".tree-main").click();
  await win.getByTestId("send").click();
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await win.getByTestId("tab").filter({ hasText: "Ejecutar" }).locator(".tab-main").click();

  await win.getByRole("button", { name: "Ninguna" }).click();
  await win.getByRole("checkbox", { name: "Incluir Eco" }).check();
  await win.getByTestId("opt-keep-responses").check();
  await win.getByTestId("opt-cookies-isolated").click();
  await run(win);
  await win.getByTestId("run-row").first().click();
  await expect(win.getByTestId("run-response")).toContainText('"method": "GET"');
  await expect(win.getByTestId("run-response")).not.toContainText("sid=abc123");

  await win.getByTestId("runner-back").click();
  await win.getByRole("button", { name: "Las de Sendix" }).click();
  await run(win);
  await win.getByTestId("run-row").first().click();
  await expect(win.getByTestId("run-response")).toContainText("sid=abc123");
});

test("past runs can be opened, repeated and exported", async () => {
  const { win } = s;
  await openRunner(win);
  await win.getByRole("checkbox", { name: "Incluir Falla" }).uncheck();
  await run(win);
  await win.getByTestId("runner-back").click();
  await expect(win.getByTestId("run-history-row")).toHaveCount(1);
  await expect(win.getByTestId("run-history-row")).toContainText("2/2");

  await win.getByTestId("run-history-open").click();
  await expect(win.getByTestId("runner-from-history")).toBeVisible();
  expect(await resultNames(win)).toEqual(["Login", "Eco", "Final"]);

  await win.getByTestId("runner-back").click();
  // Repeat brings back the same choice (Falla left out) even after changing it.
  await win.getByRole("checkbox", { name: "Incluir Falla" }).check();
  await win.getByTestId("run-history-repeat").click();
  await expect(win.getByTestId("runner-state")).toContainText("Terminada", { timeout: 30_000 });
  expect(await resultNames(win)).toEqual(["Login", "Eco", "Final"]);
  await win.getByTestId("runner-back").click();
  await expect(win.getByTestId("run-history-row")).toHaveCount(2);
  await win.screenshot({ path: resolve(shots, "runner-history-light.png") });

  const target = join(dir, "ejecucion.json");
  await s.app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, target);
  await win.getByTestId("run-history-export").first().click();
  await expect.poll(() => existsSync(target)).toBe(true);
  const report = JSON.parse(readFileSync(target, "utf8"));
  expect(report.collection).toBe("Runner demo");
  expect(report.summary).toMatchObject({ requests: 3, testsPassed: 2, testsFailed: 0 });
  expect(report.results.map((r: { name: string }) => r.name)).toEqual(["Login", "Eco", "Final"]);
});

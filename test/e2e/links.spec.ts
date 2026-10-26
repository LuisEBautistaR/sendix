/** sendix:// links from Mockix and «Crear mock desde esta colección» towards Mockix. */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, shots, type Launched } from "./app";

let s: Launched | null = null;
test.afterEach(async () => {
  await s?.close();
  s = null;
});

const pedido = () => {
  const q = new URLSearchParams({
    method: "POST",
    url: "http://127.0.0.1:3000/pedidos?pagina=2",
    body: '{"producto":"prd_1","cantidad":2}',
    headers: JSON.stringify({ "Content-Type": "application/json", "X-Origen": "mockix" }),
  });
  return `sendix://request?${q.toString()}`;
};

/** What Windows does when a link is clicked while Sendix runs: a second instance hands over its argv. */
const clickLink = (app: ElectronApplication, link: string) =>
  app.evaluate(({ app }, url) => {
    app.emit("second-instance", { preventDefault() {} }, ["C:\\Sendix\\Sendix.exe", url], "C:\\");
  }, link);

async function expectOpened(win: Page) {
  await expect(win.getByTestId("method")).toHaveValue("POST");
  await expect(win.getByTestId("url")).toHaveValue("http://127.0.0.1:3000/pedidos?pagina=2");
  await expect(win.getByTestId("params-key-0")).toHaveValue("pagina");
  await win.getByTestId("req-tab-headers").click();
  await expect(win.getByTestId("headers-key-1")).toHaveValue("X-Origen");
  await expect(win.getByTestId("headers-value-1")).toHaveValue("mockix");
  await win.getByTestId("req-tab-body").click();
  await expect(win.locator('.cm-content[data-testid="body-raw"]')).toContainText('"producto":"prd_1"');
}

test("a link asks first and opens the request in a new tab", async () => {
  s = await launch();
  const { win, app } = s;
  await expect(win.getByTestId("tab")).toHaveCount(1);
  await clickLink(app, pedido());
  const dialog = win.getByTestId("link-dialog");
  await expect(dialog).toBeVisible();
  await expect(win.getByTestId("link-request")).toContainText("POST http://127.0.0.1:3000/pedidos?pagina=2");
  await expect(dialog).toContainText("X-Origen: mockix");
  await win.screenshot({ path: resolve(shots, "link-dialog-light.png") });
  // Nothing opens before the answer.
  await expect(win.getByTestId("tab")).toHaveCount(1);
  await win.getByTestId("link-accept").click();
  await expect(dialog).toBeHidden();
  await expect(win.getByTestId("tab")).toHaveCount(2);
  await expectOpened(win);

  // Declining opens nothing.
  await clickLink(app, pedido());
  await win.getByTestId("link-reject").click();
  await expect(win.getByTestId("link-dialog")).toBeHidden();
  await expect(win.getByTestId("tab")).toHaveCount(2);
});

test("invalid links are ignored without asking", async () => {
  s = await launch();
  const { win, app } = s;
  await clickLink(app, "sendix://request?method=GET&url=file%3A%2F%2F%2FC%3A%2Fsecreto.txt");
  await clickLink(app, "sendix://borrar?todo=1");
  // A valid link right after shows that the window was listening.
  await clickLink(app, "sendix://request?method=GET&url=http%3A%2F%2F127.0.0.1%3A3000%2Fsalud");
  await expect(win.getByTestId("link-request")).toContainText("GET http://127.0.0.1:3000/salud");
  await win.getByTestId("link-reject").click();
});

test("a link that starts Sendix waits for the window and asks", async () => {
  s = await launch(true, [pedido()]);
  const { win } = s;
  await expect(win.getByTestId("link-dialog")).toBeVisible();
  await win.getByTestId("link-accept").click();
  await expectOpened(win);
});

test("«Crear mock desde esta colección» appears only with Mockix and hands it the v2.1 file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sendix-links-e2e-"));
  try {
    mkdirSync(join(dir, "collections"));
    const collection = { info: { _postman_id: "c-mock", name: "Tienda", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [{ name: "Salud", request: { method: "GET", url: "http://127.0.0.1:3000/salud" } }] };
    writeFileSync(join(dir, "collections", "Tienda.postman_collection.json"), JSON.stringify(collection));
    s = await launch();
    const { win, app } = s;
    await app.evaluate(({ app, dialog, shell }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
      const g = globalThis as unknown as { mockixName: string; opened: string[] };
      g.mockixName = "";
      g.opened = [];
      app.getApplicationNameForProtocol = () => g.mockixName;
      shell.openExternal = async (url: string) => void g.opened.push(url);
    }, dir);
    await win.getByTestId("open-workspace").click();
    const menu = () => win.getByRole("button", { name: "Acciones de Tienda" }).click();

    await menu();
    await expect(win.getByRole("menuitem", { name: "Ejecutar…" })).toBeVisible();
    await expect(win.getByRole("menuitem", { name: "Crear mock desde esta colección" })).toHaveCount(0);
    await win.keyboard.press("Escape");

    await app.evaluate(() => void ((globalThis as unknown as { mockixName: string }).mockixName = "Mockix"));
    await menu();
    await win.getByRole("menuitem", { name: "Crear mock desde esta colección" }).click();
    await expect(win.getByTestId("toast")).toContainText("confirma allí");
    const opened = () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
    await expect.poll(async () => (await opened()).length).toBe(1);
    const first = new URL((await opened())[0]!);
    expect(first.protocol).toBe("mockix:");
    expect(first.hostname).toBe("import");
    expect(Object.fromEntries(first.searchParams)).toEqual({ collection: join(dir, "collections", "Tienda.postman_collection.json") });

    // When the folder is also a Mockix workspace, Mockix may import straight into it.
    writeFileSync(join(dir, "mockix.workspace.yaml"), "version: 1\n");
    await menu();
    await win.getByRole("menuitem", { name: "Crear mock desde esta colección" }).click();
    await expect.poll(async () => (await opened()).length).toBe(2);
    expect(new URL((await opened())[1]!).searchParams.get("workspace")).toBe(dir);
  } finally {
    await s?.close();
    s = null;
    rmSync(dir, { recursive: true, force: true });
  }
});

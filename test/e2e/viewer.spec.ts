/** 0.2 U2: response viewer — folding/search viewer without a line cap, JSONPath/XPath filters, HTML preview. */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { launch, shots, type Launched } from "./app";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
let s: Launched;

test.beforeAll(async () => {
  server = await startTestServer();
});
test.afterAll(async () => server.close());
test.beforeEach(async () => {
  s = await launch();
});
test.afterEach(async () => s.close());

async function get(path: string) {
  await s.win.getByTestId("url").fill(`${server.url}${path}`);
  await s.win.keyboard.press("Control+Enter");
  await expect(s.win.getByTestId("status")).toHaveText("200 OK");
}

test("JSONPath filters a JSON response and reports bad expressions", async () => {
  const { win } = s;
  await get("/json");
  const body = win.getByTestId("response-body");
  await expect(body).toContainText('"precio": 189');

  await win.getByTestId("body-filter").fill("$.productos[*].nombre");
  await expect(win.getByTestId("body-filter-state")).toHaveText("1 resultado");
  await expect(body).toContainText('"Café de Veracruz"');
  await expect(body).not.toContainText("precio");
  await win.screenshot({ path: resolve(shots, "viewer-filter-light.png") });

  await win.getByTestId("body-filter").fill("$.productos[?(@.precio > 100)].id");
  await expect(win.getByTestId("body-filter-state")).toHaveText("1 resultado");
  await expect(body).toContainText('"prd_1"');

  await win.getByTestId("body-filter").fill("$.productos[?(@.precio >)]");
  await expect(win.getByTestId("body-filter-state")).toContainText("no válida");
  // The raw view ignores the filter.
  await win.getByTestId("body-view-raw").click();
  await expect(win.getByTestId("body-filter")).toHaveCount(0);
  await expect(body).toContainText('"precio":189');
});

test("XML is indented and filtered with XPath", async () => {
  const { win } = s;
  await get("/xml");
  const body = win.getByTestId("response-body");
  await expect(body.locator(".cm-line").nth(2)).toHaveText(/^\s+<producto id="prd_1">$/);
  await win.getByTestId("body-filter").fill("//producto/nombre/text()");
  await expect(win.getByTestId("body-filter-state")).toHaveText("2 resultados");
  await expect(body).toContainText("Té verde");
  await win.getByTestId("body-filter").fill("count(//producto)");
  await expect(body).toHaveText("2");
});

test("large responses are shown whole and searchable", async () => {
  const { win } = s;
  await get("/big");
  const body = win.getByTestId("response-body");
  await expect(body).toContainText('"id": "item-0"');
  await win.getByTestId("body-search").click();
  await win.keyboard.type("item-24999");
  await win.keyboard.press("Enter");
  await expect(body).toContainText('"id": "item-24999"');
});

test("HTML preview renders inline styles with no scripts and no network", async () => {
  const { win } = s;
  await get("/html");
  await win.getByTestId("body-view-preview").click();
  const frame = win.frameLocator('[data-testid="html-preview"]');
  await expect(frame.locator("h1")).toHaveText("Catálogo de prueba");
  await expect(frame.locator("h1")).toHaveCSS("color", "rgb(140, 85, 20)");
  await win.waitForTimeout(500);
  expect(server.hits).not.toContain("/pixel.png");
  // The script never ran: the frame title is the original one.
  expect(await frame.locator("title").textContent()).toBe("Tienda");
  await win.screenshot({ path: resolve(shots, "viewer-preview-light.png") });

  // Reading it as text removes the preview.
  await win.getByTestId("body-format").selectOption("text");
  await expect(win.getByTestId("body-view-preview")).toHaveCount(0);
  await expect(win.getByTestId("response-body")).toContainText("<h1>Catálogo de prueba</h1>");
});

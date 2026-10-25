/** M1: compose, send and read HTTP requests against a local server; history keeps them. */
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

test("sends a GET, shows the response and records it in history", async () => {
  const { win } = s;
  await expect(win.getByTestId("response-empty")).toBeVisible();
  await win.getByTestId("url").fill(`${server.url}/json?limit=10&categoria=cafe`);

  // The query string fills the parameter table.
  await expect(win.getByTestId("params-key-0")).toHaveValue("limit");
  await expect(win.getByTestId("params-value-1")).toHaveValue("cafe");

  await win.keyboard.press("Control+Enter");
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await expect(win.getByTestId("response-body")).toContainText('"nombre": "Café de Veracruz"');
  await expect(win.getByTestId("strata")).toContainText("total");

  await win.getByTestId("res-tab-cookies").click();
  await expect(win.getByTestId("response")).toContainText("abc123");
  await win.getByTestId("res-tab-timeline").click();
  await expect(win.getByTestId("sent-request")).toContainText(/User-Agent: Sendix\//);
  await expect(win.getByTestId("sent-request")).not.toContainText(/Postman-Token/i);
  await win.getByTestId("res-tab-body").click();

  await win.getByTestId("rail-history").click();
  await expect(win.getByTestId("history-entry")).toHaveCount(1);
  await expect(win.getByTestId("history-entry").first()).toContainText("200");
  await expect(win.getByTestId("resolved-request")).toContainText("GET /json?limit=10&categoria=cafe");
  await expect(win.getByTestId("recent-runs")).toContainText("200 OK");
  await win.screenshot({ path: resolve(shots, "http-light.png") });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(400); // let colour transitions finish before the capture
  await win.waitForTimeout(200);
  await win.screenshot({ path: resolve(shots, "http-dark.png") });
});

test("unchecking a parameter removes it from the URL but keeps the row", async () => {
  const { win } = s;
  await win.getByTestId("url").fill(`${server.url}/echo?a=1&b=2`);
  await win.getByRole("checkbox", { name: "Activar a" }).uncheck();
  await expect(win.getByTestId("url")).toHaveValue(`${server.url}/echo?b=2`);
  // The row stays where it was, unchecked, ready to be re-enabled.
  await expect(win.getByTestId("params-key-0")).toHaveValue("a");
  await expect(win.getByRole("checkbox", { name: "Activar a" })).not.toBeChecked();
  await win.getByRole("checkbox", { name: "Activar a" }).check();
  await expect(win.getByTestId("url")).toHaveValue(`${server.url}/echo?a=1&b=2`);
});

test("posts JSON with bearer auth and never stores the token", async () => {
  const { win } = s;
  await win.getByTestId("method").selectOption("POST");
  await win.getByTestId("url").fill(`${server.url}/echo`);
  await win.getByTestId("req-tab-body").click();
  await win.getByTestId("body-mode-raw").click();
  await win.getByTestId("body-raw").fill('{"nombre":"Café de Oaxaca","precio":349}');
  await win.getByTestId("req-tab-auth").click();
  await win.getByTestId("auth-type").selectOption("bearer");
  await win.getByTestId("auth-token").fill("tok-secreto-123");
  await win.getByTestId("send").click();

  await expect(win.getByTestId("status")).toHaveText("200 OK");
  const body = win.getByTestId("response-body");
  await expect(body).toContainText('"method": "POST"');
  await expect(body).toContainText('"authorization": "Bearer tok-secreto-123"');
  await expect(body).toContainText('"content-type": "application/json"');

  const stored = await win.evaluate(() => window.sendix.history.list());
  expect(stored?.[0]?.request.auth).toEqual({ type: "bearer", token: "" });
  expect(stored?.[0]?.redacted).toBe(true);

  // Reopening from history explains why the token is missing.
  await win.getByTestId("rail-history").click();
  await win.getByTestId("history-entry").first().click();
  await expect(win.getByTestId("tab")).toHaveCount(2);
  await expect(win.getByText("las credenciales no se guardan ahí")).toBeVisible();
});

test("shows 4xx responses and transport errors differently", async () => {
  const { win } = s;
  await win.getByTestId("url").fill(`${server.url}/status/422`);
  await win.getByTestId("send").click();
  await expect(win.getByTestId("status")).toHaveText("422 Unprocessable Entity");

  await win.getByTestId("url").fill("http://127.0.0.1:1/nada");
  await win.getByTestId("send").click();
  await expect(win.getByTestId("response-error")).toBeVisible();
  await expect(win.getByTestId("error-code")).toHaveText("ECONNREFUSED");
  await expect(win.getByTestId("response-error")).toContainText("rechazó la conexión");
  await expect(win.getByTestId("send")).toBeEnabled();
  await win.screenshot({ path: resolve(shots, "http-error-light.png") });
});

test("cancels a slow request", async () => {
  const { win } = s;
  await win.getByTestId("url").fill(`${server.url}/slow?ms=8000`);
  await win.getByTestId("send").click();
  await expect(win.getByTestId("response-sending")).toBeVisible();
  await win.getByTestId("cancel").click();
  await expect(win.getByTestId("response-cancelled")).toBeVisible();
  await expect(win.getByTestId("send")).toBeEnabled();
});

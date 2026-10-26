/** 0.2 U1: the Settings screen, the theme and the request preferences main applies. */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

const prefersDark = (s: Launched) => s.win.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
const nativeTheme = (s: Launched) => s.app.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));

test("the theme can be pinned to light or dark and back to the system", async () => {
  const { win } = s;
  // Playwright pins pages to light; let the page see what Electron reports.
  await win.emulateMedia({ colorScheme: null });
  await win.getByTestId("rail-settings").click();
  await expect(win.getByTestId("settings")).toBeVisible();
  await expect(win.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");

  await win.getByTestId("theme-dark").click();
  await expect(win.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => prefersDark(s)).toBe(true);
  expect(await nativeTheme(s)).toEqual({ source: "dark", dark: true });
  await win.waitForTimeout(400); // colour transitions
  await win.screenshot({ path: resolve(shots, "settings-dark.png") });

  await win.getByTestId("theme-light").click();
  await expect.poll(() => prefersDark(s)).toBe(false);
  expect((await nativeTheme(s)).source).toBe("light");
  await win.waitForTimeout(400);
  await win.screenshot({ path: resolve(shots, "settings-light.png") });

  await win.getByTestId("theme-system").click();
  expect((await nativeTheme(s)).source).toBe("system");

  // Stored in settings.json under the user's profile.
  const userData = await s.app.evaluate(({ app }) => app.getPath("userData"));
  await expect.poll(() => JSON.parse(readFileSync(join(userData, "settings.json"), "utf8")).prefs.theme).toBe("system");
});

test("Ctrl+, opens Settings; editor and timeout preferences apply", async () => {
  const { win } = s;
  await win.keyboard.press("Control+,");
  await expect(win.getByTestId("settings")).toBeVisible();

  await win.getByTestId("pref-font-size").fill("16");
  await win.getByTestId("pref-font-size").press("Enter");
  await expect.poll(() => win.evaluate(() => document.documentElement.style.getPropertyValue("--code-size"))).toBe("16px");
  // Out of range is clamped on commit.
  await win.getByTestId("pref-font-size").fill("40");
  await win.getByTestId("pref-font-size").blur();
  await expect(win.getByTestId("pref-font-size")).toHaveValue("20");

  await win.getByTestId("pref-timeout").fill("45");
  await win.getByTestId("pref-timeout").press("Enter");
  await win.keyboard.press("Control+t");
  await win.getByTestId("req-tab-settings").click();
  await expect(win.getByTestId("req-timeout")).toHaveValue("45");

  await win.getByTestId("rail-settings").click();
  await win.getByTestId("prefs-reset").click();
  await expect(win.getByTestId("pref-font-size")).toHaveValue("12");
  await expect(win.getByTestId("pref-timeout")).toHaveValue("30");
  await expect(win.getByTestId("prefs-reset")).toBeDisabled();
});

test("global request switches reach the engine: no-cache header and redirects", async () => {
  const { win } = s;
  await win.getByTestId("rail-settings").click();
  await win.getByTestId("pref-no-cache").check();
  await win.getByTestId("pref-redirects").uncheck();
  await win.getByTestId("pref-verify-tls").uncheck();
  await expect(win.getByTestId("pref-tls-off")).toBeVisible();

  await win.keyboard.press("Control+t");
  await win.getByTestId("url").fill(`${server.url}/echo`);
  await win.keyboard.press("Control+Enter");
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await expect(win.getByTestId("response-body")).toContainText('"cache-control": "no-cache"');

  // The request's own setting says "follow", but Settings turned redirects off for all.
  await win.getByTestId("url").fill(`${server.url}/redirect`);
  await win.keyboard.press("Control+Enter");
  await expect(win.getByTestId("status")).toHaveText("302 Found");
});

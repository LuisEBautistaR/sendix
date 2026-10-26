/** 0.2.1: the request body editor highlights JSON and {{variables}}; the request/response divider drags and is remembered. */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { launch, shots, type Launched } from "./app";

let s: Launched;
test.beforeEach(async () => {
  s = await launch();
});
test.afterEach(async () => s.close());

test("the JSON body is highlighted and {{variables}} are marked", async () => {
  const { win } = s;
  await win.getByTestId("req-tab-body").click();
  await win.getByTestId("body-mode-raw").click();
  await win.getByTestId("body-raw").click();
  await win.keyboard.insertText('{\n"model": "llama3.1:8b",\n"stream": false,\n"token": "{{token}}"\n}');
  const body = win.locator('.cm-content[data-testid="body-raw"]');
  const key = body.locator("span", { hasText: '"model"' }).first();
  const text = body.locator("span", { hasText: '"llama3.1:8b"' }).first();
  await expect(key).toBeVisible();
  // Keys and strings get different colours from the theme tokens.
  const [keyColor, textColor] = await Promise.all([key.evaluate((e) => getComputedStyle(e).color), text.evaluate((e) => getComputedStyle(e).color)]);
  expect(keyColor).not.toBe(textColor);
  await expect(body.locator(".cm-var")).toHaveText("{{token}}");
  await win.screenshot({ path: resolve(shots, "body-editor-light.png") });
});

test("the divider drags, is remembered, and answers keyboard and double click", async () => {
  const { win, app } = s;
  const handle = win.getByTestId("split-handle");
  const split = win.locator(".split");
  const box = (await split.boundingBox())!;
  const h = (await handle.boundingBox())!;
  await expect(handle).toHaveAttribute("aria-valuenow", "46");

  await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.3, h.y + h.height / 2, { steps: 8 });
  await win.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "30");
  const left = (await split.locator("> :first-child").boundingBox())!;
  expect(Math.abs(left.width - box.width * 0.3)).toBeLessThan(6);

  // Saved in settings.json, so a new tab uses it too.
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  await expect.poll(async () => (await win.evaluate(() => window.sendix.prefs.get()))?.ui.splitPercent).toBe(30);
  await win.keyboard.press("Control+t");
  await expect(win.getByTestId("split-handle")).toHaveAttribute("aria-valuenow", "30");
  expect(userData).toBeTruthy();

  // Never narrower than a quarter of the screen.
  const h2 = (await win.getByTestId("split-handle").boundingBox())!;
  await win.mouse.move(h2.x + 1, h2.y + 40);
  await win.mouse.down();
  await win.mouse.move(box.x + 10, h2.y + 40, { steps: 5 });
  await win.mouse.up();
  await expect(win.getByTestId("split-handle")).toHaveAttribute("aria-valuenow", "25");

  await win.getByTestId("split-handle").focus();
  await win.keyboard.press("ArrowRight");
  await expect(win.getByTestId("split-handle")).toHaveAttribute("aria-valuenow", "27");
  await win.getByTestId("split-handle").dblclick();
  await expect(win.getByTestId("split-handle")).toHaveAttribute("aria-valuenow", "46");
});

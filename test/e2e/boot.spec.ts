/**
 * The M0 promises, checked on the built app: the window opens hardened, the
 * engine answers, the bridge rejects bad calls, and a crashed engine restarts.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { launch, openSystemStatus, shots } from "./app";

test("opens a hardened window and the engine answers", async () => {
  const { app, win, close } = await launch();
  try {
    await openSystemStatus(win);
    await expect(win.getByTestId("ping-latency")).toHaveText(/^\d+ ms$/);

    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      // Not in Electron's typings, but it reports the preferences actually applied to the page.
      const contents = w.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences };
      const p = contents.getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webviewTag: p.webviewTag, url: w.webContents.getURL() };
    });
    expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, url: "app://sendix/index.html" });

    for (const id of ["no-node", "bridge", "csp", "origin"]) {
      await expect(win.getByTestId(`check-${id}`)).toHaveAttribute("data-passed", "true");
    }

    // The bridge validates in main: wrong params and unknown methods never reach the engine.
    const badParams = await win.evaluate(() => window.sendix.engine.call("system.ping", { sentAt: "now" } as never));
    expect(badParams).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    const unknown = await win.evaluate(() => window.sendix.engine.call("fs.readFile" as never, {} as never));
    expect(unknown).toMatchObject({ ok: false, error: { code: "UNKNOWN_METHOD" } });

    // No popups and no navigation away from app://.
    expect(await win.evaluate(() => window.open("https://example.com/") === null)).toBe(true);
    await win.evaluate(() => {
      location.href = "https://example.com/";
    });
    await win.waitForTimeout(500);
    expect(win.url()).toBe("app://sendix/index.html");

    await win.screenshot({ path: resolve(shots, "system-light.png") });
  } finally {
    await close();
  }
});

test("restarts the engine after it crashes", async () => {
  const { win, close } = await launch();
  try {
    await openSystemStatus(win);
    const firstPid = await win.getByTestId("engine-pid").textContent();
    const crash = await win.evaluate(() => window.sendix.engine.call("diagnostics.crash", { exitCode: 3 }));
    expect(crash).toEqual({ ok: true, value: { scheduled: true } });

    await expect(win.getByTestId("engine-restarts")).toHaveText("1", { timeout: 15_000 });
    await expect(win.getByTestId("engine-state")).toHaveText("Listo", { timeout: 15_000 });
    // Development builds never look for updates.
    await expect(win.getByTestId("update-status")).toHaveText("Solo en la versión instalada");
    await expect(win.getByTestId("update-check")).toHaveCount(0);
    await expect(win.getByTestId("engine-pid")).not.toHaveText(firstPid ?? "");
    await expect(win.getByTestId("ping-latency")).toHaveText(/^\d+ ms$/);
    await expect(win.getByTestId("event-log")).toContainText("Motor caído con código 3; reinicio 1");
  } finally {
    await close();
  }
});

test("test-only methods do not exist outside test mode", async () => {
  const { win, close } = await launch(false);
  try {
    const crash = await win.evaluate(() => window.sendix.engine.call("diagnostics.crash", { exitCode: 3 }));
    expect(crash).toMatchObject({ ok: false, error: { code: "UNKNOWN_METHOD" } });
  } finally {
    await close();
  }
});

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
export const shots = resolve(root, "test-results/screens");

export interface Launched {
  app: ElectronApplication;
  win: Page;
  close(): Promise<void>;
}

/** Starts the built app with a throwaway profile (history included). */
export async function launch(testMode = true): Promise<Launched> {
  const userData = mkdtempSync(join(tmpdir(), "sendix-e2e-"));
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env["ELECTRON_RENDERER_URL"];
  if (testMode) {
    env["SENDIX_TEST"] = "1";
    env["SENDIX_USER_DATA"] = userData;
  } else delete env["SENDIX_TEST"];
  const app = await electron.launch({ args: ["."], cwd: root, env });
  const win = await app.firstWindow();
  await expect(win.locator(".statusbar .engine-dot")).toHaveText("Motor listo", { timeout: 20_000 });
  return {
    app,
    win,
    close: async () => {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

export async function openSystemStatus(win: Page): Promise<void> {
  await win.getByTestId("rail-system").click();
  await expect(win.getByTestId("engine-state")).toHaveText("Listo", { timeout: 20_000 });
}

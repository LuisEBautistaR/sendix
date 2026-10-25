/** Per-user app state in <userData>/settings.json: recent workspaces and the active environment of each. */
import { readFile, rename, writeFile } from "node:fs/promises";
import type { RecentWorkspace } from "@shared/workspace";

export interface AppSettings {
  recentWorkspaces: RecentWorkspace[];
  lastWorkspace: string | null;
  /** Workspace path → active environment id. Per user, so it never ends up in the shared folder. */
  activeEnvironment: Record<string, string>;
}

const DEFAULTS: AppSettings = { recentWorkspaces: [], lastWorkspace: null, activeEnvironment: {} };
const MAX_RECENT = 10;

export class SettingsStore {
  #data: AppSettings = structuredClone(DEFAULTS);
  #writing: Promise<void> = Promise.resolve();

  private constructor(readonly file: string) {}

  static async open(file: string): Promise<SettingsStore> {
    const store = new SettingsStore(file);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<AppSettings>;
      store.#data = {
        recentWorkspaces: Array.isArray(parsed.recentWorkspaces) ? parsed.recentWorkspaces.filter((r) => r && typeof r.path === "string") : [],
        lastWorkspace: typeof parsed.lastWorkspace === "string" ? parsed.lastWorkspace : null,
        activeEnvironment: parsed.activeEnvironment && typeof parsed.activeEnvironment === "object" ? parsed.activeEnvironment : {},
      };
    } catch {
      /* first run or unreadable: defaults */
    }
    return store;
  }

  get data(): Readonly<AppSettings> {
    return this.#data;
  }

  update(change: (data: AppSettings) => void): Promise<void> {
    change(this.#data);
    const json = `${JSON.stringify(this.#data, null, 2)}\n`;
    this.#writing = this.#writing
      .catch(() => {})
      .then(async () => {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, json, "utf8");
        await rename(tmp, this.file);
      });
    return this.#writing;
  }

  rememberWorkspace(path: string, name: string): Promise<void> {
    return this.update((d) => {
      d.recentWorkspaces = [{ path, name, openedAt: Date.now() }, ...d.recentWorkspaces.filter((r) => r.path !== path)].slice(0, MAX_RECENT);
      d.lastWorkspace = path;
    });
  }
}

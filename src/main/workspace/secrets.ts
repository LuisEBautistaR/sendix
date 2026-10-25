/**
 * Secret environment values, encrypted with Electron's safeStorage (DPAPI on
 * Windows, Keychain on macOS, libsecret on Linux) in <userData>/secrets.bin.
 * They are never written to the workspace folder.
 */
import { safeStorage } from "electron";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { SecretStore } from "./workspace";

export class EncryptedSecretStore implements SecretStore {
  #values = new Map<string, string>();
  #writing: Promise<void> = Promise.resolve();

  private constructor(readonly file: string) {}

  static async open(file: string): Promise<EncryptedSecretStore> {
    const store = new EncryptedSecretStore(file);
    // Without OS encryption (e.g. Linux with no keyring) the app still runs; only saving secrets is refused.
    if (!safeStorage.isEncryptionAvailable()) return store;
    try {
      const json = safeStorage.decryptString(await readFile(file));
      const parsed: unknown = JSON.parse(json);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") store.#values.set(k, v);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[main] Could not read secrets", err);
    }
    return store;
  }

  get(key: string): string | undefined {
    return this.#values.get(key);
  }

  set(key: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      return Promise.reject(new Error("El cifrado del sistema no está disponible: no se pueden guardar secretos en este equipo."));
    }
    this.#values.set(key, value);
    return this.#flush();
  }

  delete(key: string): Promise<void> {
    if (!this.#values.delete(key)) return Promise.resolve();
    return this.#flush();
  }

  #flush(): Promise<void> {
    const snapshot = JSON.stringify(Object.fromEntries(this.#values));
    this.#writing = this.#writing
      .catch(() => {})
      .then(async () => {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, safeStorage.encryptString(snapshot));
        await rename(tmp, this.file);
      });
    return this.#writing;
  }
}

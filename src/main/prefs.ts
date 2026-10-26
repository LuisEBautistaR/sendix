import { readFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import { IpcChannels } from "@shared/ipc";
import { applyRequestPrefs, bypassesProxy, clientCertFor, networkPaths, parseProxyServer, prefsSchema, type Prefs } from "@shared/prefs";
import type { HttpRequest, NetworkOptions } from "@shared/http";
import type { SettingsStore } from "./settings";
import type { EncryptedSecretStore } from "./workspace/secrets";
import { isTrustedSender } from "./security";

/** What a network file picker is for: the dialog title and filters. */
const PICKS: Record<"ca" | "cert" | "key" | "pfx", { title: string; filters: Electron.FileFilter[] }> = {
  ca: { title: "Autoridad de certificación (PEM)", filters: [{ name: "Certificados", extensions: ["pem", "crt", "cer"] }] },
  cert: { title: "Certificado de cliente", filters: [{ name: "Certificados", extensions: ["crt", "pem", "cer"] }] },
  key: { title: "Clave privada del certificado", filters: [{ name: "Claves", extensions: ["key", "pem"] }] },
  pfx: { title: "Certificado PFX o P12", filters: [{ name: "PFX / P12", extensions: ["pfx", "p12"] }] },
};
type PickKind = keyof typeof PICKS;

const PROXY_SECRET = "prefs:proxy-password";
const certSecret = (id: string) => `prefs:cert-passphrase:${id}`;

/** First proxy of a PAC-style answer ("PROXY host:port; DIRECT"); null for DIRECT. */
export function firstProxy(answer: string): { host: string; port: number } | null {
  for (const part of answer.split(";")) {
    const m = /^\s*(PROXY|HTTPS)\s+([^\s:]+|\[[^\]]+\]):(\d+)\s*$/i.exec(part);
    if (m) return { host: m[2]!.replace(/^\[|\]$/g, ""), port: Number(m[3]) };
    if (/^\s*DIRECT\s*$/i.test(part)) return null;
  }
  return null;
}

/** Preferences live in settings.json; main applies the theme, the request ones and the network ones itself. */
export class PrefsService {
  /** Paths picked in a dialog during this session; stored paths came from one earlier. */
  readonly #picked = new Set<string>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: EncryptedSecretStore,
  ) {
    // Electron then answers prefers-color-scheme for the page and the title bar follows.
    nativeTheme.themeSource = settings.data.prefs.theme;
  }

  get prefs(): Prefs {
    return this.settings.data.prefs;
  }

  /** What actually goes to the engine: global switches, no-cache header, size limit, proxy and certificates. */
  async prepare(request: HttpRequest): Promise<{ request: HttpRequest; maxResponseBytes: number; network: NetworkOptions }> {
    const p = this.prefs;
    return {
      request: applyRequestPrefs(request, p.request),
      maxResponseBytes: p.request.maxResponseMb * 1024 * 1024,
      network: await this.networkFor(request.url),
    };
  }

  async networkFor(rawUrl: string): Promise<NetworkOptions> {
    const n = this.prefs.network;
    let url: URL | null = null;
    try {
      // Variables may still be unresolved here; then only the CA applies.
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`);
    } catch {
      url = null;
    }
    let proxy: NetworkOptions["proxy"] = null;
    if (url && n.proxy.mode !== "none" && !bypassesProxy(url.hostname, n.proxy.bypass)) {
      if (n.proxy.mode === "custom") {
        const server = parseProxyServer(n.proxy.server);
        if (server) proxy = { ...server, username: n.proxy.username, password: n.proxy.username ? (this.secrets.get(PROXY_SECRET) ?? "") : "" };
      } else {
        const resolved = firstProxy(await session.defaultSession.resolveProxy(url.toString()));
        if (resolved) proxy = { ...resolved, username: "", password: "" };
      }
    }
    const ca = n.caFile ? await readFile(n.caFile, "utf8").catch(() => null) : null;
    const chosen = url ? clientCertFor(url.toString(), n.clientCerts) : null;
    let cert: NetworkOptions["cert"] = null;
    if (chosen) {
      const read = async (path: string | null, encoding: "utf8" | "base64") => (path ? await readFile(path, encoding).catch(() => undefined) : undefined);
      const host = chosen.host.includes(":") ? chosen.host : `${chosen.host}:443`;
      cert = {
        match: `https://${host}/*`,
        cert: await read(chosen.certFile, "utf8"),
        key: await read(chosen.keyFile, "utf8"),
        pfx: await read(chosen.pfxFile, "base64"),
        passphrase: this.secrets.get(certSecret(chosen.id)),
      };
    }
    return { proxy, ca, cert };
  }

  /** Which secrets exist, so the screen can say "saved" without ever seeing them. */
  #secretState(): { proxyPassword: boolean; certPassphrases: string[] } {
    return {
      proxyPassword: Boolean(this.secrets.get(PROXY_SECRET)),
      certPassphrases: this.prefs.network.clientCerts.filter((c) => this.secrets.get(certSecret(c.id))).map((c) => c.id),
    };
  }

  register(broadcast: (channel: string, payload: unknown) => void): void {
    ipcMain.handle(IpcChannels.prefsGet, (event): Prefs | null => (isTrustedSender(event.senderFrame) ? this.prefs : null));
    ipcMain.handle(IpcChannels.prefsSet, async (event, raw: unknown): Promise<Prefs | null> => {
      if (!isTrustedSender(event.senderFrame)) return null;
      const parsed = prefsSchema.safeParse(raw);
      if (!parsed.success) return null;
      // Only paths the user picked in a dialog (now or before) may be read and sent.
      const known = new Set([...networkPaths(this.prefs.network), ...this.#picked]);
      if (networkPaths(parsed.data.network).some((p) => !known.has(p))) return null;
      const removed = this.prefs.network.clientCerts.filter((c) => !parsed.data.network.clientCerts.some((n) => n.id === c.id));
      await this.settings.update((d) => {
        d.prefs = parsed.data;
      });
      for (const c of removed) await this.secrets.delete(certSecret(c.id)).catch(() => undefined);
      nativeTheme.themeSource = parsed.data.theme;
      broadcast(IpcChannels.prefsChanged, parsed.data);
      return parsed.data;
    });
    ipcMain.handle(IpcChannels.prefsPick, async (event, kind: unknown): Promise<string | null> => {
      if (!isTrustedSender(event.senderFrame) || typeof kind !== "string" || !(kind in PICKS)) return null;
      const spec = PICKS[kind as PickKind];
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { title: spec.title, properties: ["openFile" as const], filters: [...spec.filters, { name: "Todos los archivos", extensions: ["*"] }] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const path = picked.canceled ? undefined : picked.filePaths[0];
      if (!path) return null;
      this.#picked.add(path);
      return path;
    });
    ipcMain.handle(IpcChannels.prefsSecret, async (event, name: unknown, value: unknown): Promise<boolean> => {
      if (!isTrustedSender(event.senderFrame) || typeof name !== "string" || (value !== null && (typeof value !== "string" || value.length > 4_096))) return false;
      const key = name === "proxy" ? PROXY_SECRET : name.startsWith("cert:") && this.prefs.network.clientCerts.some((c) => `cert:${c.id}` === name) ? certSecret(name.slice(5)) : null;
      if (!key) return false;
      if (value === null || value === "") await this.secrets.delete(key);
      else await this.secrets.set(key, value);
      return true;
    });
    ipcMain.handle(IpcChannels.prefsSecrets, (event) => (isTrustedSender(event.senderFrame) ? this.#secretState() : null));
    ipcMain.handle(IpcChannels.profileReveal, (event) => {
      if (isTrustedSender(event.senderFrame)) void shell.openPath(app.getPath("userData"));
    });
  }
}

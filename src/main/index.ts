import { app, BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDevelopmentCsp, registerAppScheme, serveRenderer } from "./protocol";
import { denyPermissions, hardenApp, setDevelopmentOrigin } from "./security";
import { EngineHost } from "./engine-host";
import { HistoryStore } from "./history";
import { RunStore } from "./runs";
import { SettingsStore } from "./settings";
import { PrefsService } from "./prefs";
import { EncryptedSecretStore } from "./workspace/secrets";
import { WorkspaceController } from "./workspace/controller";
import { broadcast, registerRpcRouter } from "./rpc-router";
import { UpdateService } from "./updates";
import { RunnerController } from "./runner";
import { RealtimeRelay } from "./realtime";
import { GrpcFiles } from "./grpc-files";
import { createMainWindow } from "./window";
import { registerPreviews } from "./preview";
import { LinkService } from "./links";
import { linkFromArgv } from "@shared/links";

const mainDir = dirname(fileURLToPath(import.meta.url));
const devUrl = !app.isPackaged ? (process.env["ELECTRON_RENDERER_URL"] ?? null) : null;
/** Test hooks (e.g. crashing the engine on purpose) exist only in unpackaged builds started with SENDIX_TEST=1. */
const testMode = !app.isPackaged && process.env["SENDIX_TEST"] === "1";
// Tests get a throwaway profile so they never touch the user's history.
if (testMode && process.env["SENDIX_USER_DATA"]) app.setPath("userData", process.env["SENDIX_USER_DATA"]);

const log = (message: string, detail?: unknown): void => {
  if (detail === undefined) console.log(`[main] ${message}`);
  else console.error(`[main] ${message}`, detail);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppScheme();
  hardenApp();
  setDevelopmentOrigin(devUrl);

  const engine = new EngineHost({ entry: join(mainDir, "engine.js"), testMode, version: app.getVersion(), log: (m, d) => log(m, d) });
  let history: HistoryStore | null = null;
  let runs: RunStore | null = null;
  let mainWindow: BrowserWindow | null = null;
  let links: LinkService | null = null;
  // A sendix:// link that started the app (Windows passes it as an argument), handled once main is ready.
  let startLink = linkFromArgv(process.argv);

  // Windows: a link clicked while Sendix runs starts a second instance that hands its argv here.
  app.on("second-instance", (_event, argv) => {
    const link = linkFromArgv(argv);
    if (link) {
      if (links) links.handle(link);
      else startLink = link;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  // macOS delivers links as an event instead.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (links) links.handle(url);
    else startLink = url;
  });

  app.whenReady().then(async () => {
    denyPermissions();
    serveRenderer(join(mainDir, "../renderer"));
    if (devUrl) applyDevelopmentCsp(devUrl);

    const userData = app.getPath("userData");
    history = new HistoryStore(join(userData, "sendix.db"));
    runs = new RunStore(join(userData, "sendix.db"));
    runs.register(app.getVersion());
    const settings = await SettingsStore.open(join(userData, "settings.json"));
    const secrets = await EncryptedSecretStore.open(join(userData, "secrets.bin"));
    const prefs = new PrefsService(settings, secrets);
    prefs.register(broadcast);
    registerPreviews();
    const workspaces = new WorkspaceController(settings, secrets, engine);
    workspaces.register();
    LinkService.registerProtocol();
    links = new LinkService(workspaces, broadcast, (m, d) => log(m, d));
    links.register();
    const grpcFiles = new GrpcFiles(workspaces);
    grpcFiles.register();
    registerRpcRouter(engine, history, workspaces, new RealtimeRelay(engine), grpcFiles, prefs, testMode);
    new RunnerController(engine, workspaces, prefs, runs).register();
    const updates = new UpdateService((m, d) => log(m, d));
    updates.register(broadcast);
    engine.start();
    await workspaces.restoreLast();
    mainWindow = createMainWindow(join(mainDir, "../preload/index.cjs"), devUrl);
    mainWindow.on("closed", () => (mainWindow = null));
    if (startLink) {
      links.handle(startLink);
      startLink = null;
    }
    updates.start();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    engine.stop();
    history?.close();
    runs?.close();
  });
}

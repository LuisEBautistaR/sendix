/** 0.2 U4: TLS errors explained, extra CA, client certificates, proxy and inherited request behaviour. */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, shots, type Launched } from "./app";
import { startTestServer, type TestServer } from "../fixtures/server";
import { TLS_DIR, startNetworkFixtures, type NetworkFixtures } from "../fixtures/network";

let server: TestServer;
let net: NetworkFixtures;
let s: Launched;

/** The next file dialogs answer these paths, in order. */
async function answerDialogs(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, list) => {
    const queue = [...list];
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [queue.shift()!] })) as typeof dialog.showOpenDialog;
  }, paths);
}

async function send(win: Page, url: string) {
  await win.keyboard.press("Control+t");
  await win.getByTestId("url").fill(url);
  await win.keyboard.press("Control+Enter");
}

test.beforeAll(async () => {
  server = await startTestServer();
  net = await startNetworkFixtures();
});
test.afterAll(async () => {
  await server.close();
  await net.close();
});
test.beforeEach(async () => {
  s = await launch();
  s.win.on("dialog", (d) => void d.accept());
});
test.afterEach(async () => s.close());

test("an unknown CA is explained; it works without verification or with the CA added", async () => {
  const { win, app } = s;
  await send(win, `${net.httpsUrl}/json`);
  await expect(win.getByTestId("response-error")).toContainText("no es de confianza", { ignoreCase: true });
  await expect(win.getByTestId("tls-send-insecure")).toBeVisible();
  await win.screenshot({ path: resolve(shots, "tls-error-light.png") });
  await win.getByTestId("tls-send-insecure").click();
  await expect(win.getByTestId("status")).toHaveText("200 OK");

  await win.getByTestId("rail-settings").click();
  await answerDialogs(app, [join(TLS_DIR, "ca.crt")]);
  await win.getByTestId("pref-ca-pick").click();
  await expect(win.getByTestId("pref-ca-file")).toHaveText("ca.crt");
  await send(win, `${net.httpsUrl}/json`);
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await expect(win.getByTestId("response-body")).toContainText('"seguro": true');
});

test("a client certificate is sent only to its host and port", async () => {
  const { win, app } = s;
  await win.getByTestId("rail-settings").click();
  await answerDialogs(app, [join(TLS_DIR, "ca.crt"), join(TLS_DIR, "client.crt"), join(TLS_DIR, "client.key")]);
  await win.getByTestId("pref-ca-pick").click();
  await expect(win.getByTestId("pref-ca-file")).toHaveText("ca.crt");

  await send(win, `${net.mtlsUrl}/quien`);
  await expect(win.getByTestId("response-error")).toBeVisible();

  await win.getByTestId("rail-settings").click();
  await win.getByTestId("cert-host").fill(`127.0.0.1:${net.mtlsPort}`);
  await win.getByTestId("cert-pick-cert").click();
  await win.getByTestId("cert-pick-key").click();
  await win.getByTestId("cert-add").click();
  await expect(win.getByTestId("client-cert")).toContainText(`127.0.0.1:${net.mtlsPort}`);
  await win.screenshot({ path: resolve(shots, "settings-network-light.png"), fullPage: true });

  await send(win, `${net.mtlsUrl}/quien`);
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await expect(win.getByTestId("response-body")).toContainText('"cliente": "cliente-de-prueba"');
});

test("a custom proxy with authentication carries HTTP requests; exceptions skip it", async () => {
  const { win } = s;
  await win.getByTestId("rail-settings").click();
  await win.getByTestId("proxy-custom").click();
  await win.getByTestId("pref-proxy-server").fill(`127.0.0.1:${net.proxyPort}`);
  await win.getByTestId("pref-proxy-server").press("Enter");
  await win.getByTestId("pref-proxy-user").fill("ana");
  await win.getByTestId("pref-proxy-user").press("Enter");
  await win.getByTestId("pref-proxy-password").fill("pw");
  await win.getByTestId("pref-proxy-password-save").click();
  await win.getByTestId("pref-proxy-bypass").fill("127.0.0.1");
  await win.getByTestId("pref-proxy-bypass").press("Enter");

  await send(win, "http://api.ejemplo.test/productos?categoria=cafe");
  await expect(win.getByTestId("status")).toHaveText("200 OK");
  await expect(win.getByTestId("response-body")).toContainText('"viaProxy": true');
  await expect(win.getByTestId("response-body")).toContainText(`"auth": "Basic ${Buffer.from("ana:pw").toString("base64")}"`);
  expect(net.proxied.at(-1)?.url).toBe("http://api.ejemplo.test/productos?categoria=cafe");

  // 127.0.0.1 is an exception: the fixture server answers directly.
  const before = net.proxied.length;
  await send(win, `${server.url}/json`);
  await expect(win.getByTestId("response-body")).toContainText("Café de Veracruz");
  expect(net.proxied.length).toBe(before);
  // The password never reaches the page or settings.json.
  const userData = await s.app.evaluate(({ app }) => app.getPath("userData"));
  expect(readFileSync(join(userData, "settings.json"), "utf8")).not.toContain('"pw"');
});

test("request behaviour is inherited from the collection and saved in protocolProfileBehavior", async () => {
  const { win, app } = s;
  const dir = mkdtempSync(join(tmpdir(), "sendix-net-e2e-"));
  try {
    mkdirSync(join(dir, "collections"));
    writeFileSync(
      join(dir, "collections", "Redirecciones.postman_collection.json"),
      JSON.stringify({
        info: { _postman_id: "c-redir", name: "Redirecciones", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
        protocolProfileBehavior: { maxRedirects: 0 },
        item: [{ name: "Redirige", request: { method: "GET", url: `${server.url}/redirect` } }],
      }),
    );
    await answerDialogs(app, [dir]);
    await win.getByTestId("open-workspace").click();
    await win.getByTestId("tree-request").filter({ hasText: "Redirige" }).locator(".tree-main").click();
    await win.getByTestId("send").click();
    // The collection allows no redirects at all.
    await expect(win.getByTestId("response-error")).toBeVisible();

    await win.getByTestId("req-tab-settings").click();
    await win.getByTestId("req-max-redirects").fill("3");
    await win.getByTestId("send").click();
    await expect(win.getByTestId("status")).toHaveText("200 OK");
    await win.keyboard.press("Control+s");
    await expect.poll(() => readFileSync(join(dir, "collections", readdirSync(join(dir, "collections"))[0]!), "utf8")).toContain('"maxRedirects": 3');
    const saved = JSON.parse(readFileSync(join(dir, "collections", readdirSync(join(dir, "collections"))[0]!), "utf8"));
    expect(saved.item[0].protocolProfileBehavior).toEqual({ maxRedirects: 3 });
    expect(saved.protocolProfileBehavior).toEqual({ maxRedirects: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

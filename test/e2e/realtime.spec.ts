/** M4: WebSocket and Socket.IO connections against the local fixture server. */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, shots, type Launched } from "./app";
import { startTestServer, type TestServer } from "../fixtures/server";

let server: TestServer;
let s: Launched;

/** Replaces the composer's text. */
async function compose(win: Page, text: string) {
  await win.getByTestId("rt-message").click();
  await win.keyboard.press("Control+A");
  await win.keyboard.press("Delete");
  await win.keyboard.insertText(text);
}

test.beforeAll(async () => {
  server = await startTestServer();
});
test.afterAll(async () => server.close());
test.beforeEach(async () => {
  s = await launch();
  s.win.on("dialog", (d) => void d.accept());
});
test.afterEach(async () => s.close());

test("talks to a WebSocket: headers, subprotocol, text, binary and the server's close", async () => {
  const { win } = s;
  await win.getByTestId("method").selectOption("websocket");
  await expect(win.getByTestId("connect")).toBeVisible();
  await win.getByTestId("url").fill(`${server.wsUrl}/ws/privado`);

  // Without the header the handshake is rejected with its status.
  await win.getByTestId("connect").click();
  await expect(win.getByTestId("rt-state")).toContainText("401");
  await expect(win.getByTestId("rt-failure")).toContainText("rechazó la conexión");

  await win.getByTestId("rt-tab-headers").click();
  await win.getByTestId("headers-key-0").fill("X-Clave");
  await win.getByTestId("headers-value-0").fill("abrete");
  await win.getByTestId("subprotocols").fill("tienda.v2, tienda.v1");
  await win.getByTestId("rt-tab-message").click();
  await win.keyboard.press("Control+Enter");
  await expect(win.getByTestId("rt-state")).toContainText("101 Switching Protocols");
  await expect(win.getByTestId("handshake")).toContainText("tienda.v2");
  await expect(win.getByTestId("msg-in").first()).toContainText('"clave":"abrete"');

  await compose(win, '{ "tipo": "suscribir", "canal": "pedidos" }');
  await win.getByTestId("send-message").click();
  await expect(win.getByTestId("msg-out")).toHaveCount(1);
  await expect(win.getByTestId("msg-in").nth(1)).toContainText('eco: { "tipo": "suscribir"');

  await win.getByTestId("save-message").click();
  await expect(win.getByTestId("saved-messages").locator("li")).toHaveCount(1);

  await compose(win, "binario");
  await win.keyboard.press("Control+Enter");
  await expect(win.getByTestId("msg-in").nth(2)).toContainText("Binario · 00 01 02 fa");
  await win.getByTestId("msg-in").nth(1).click();
  await expect(win.locator(".msg-detail")).toContainText("eco:");
  await win.screenshot({ path: resolve(shots, "websocket.png") });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(400); // let colour transitions finish before the capture
  await win.screenshot({ path: resolve(shots, "websocket-dark.png") });
  await win.emulateMedia({ colorScheme: "light" });

  await compose(win, "cerrar");
  await win.getByTestId("send-message").click();
  await expect(win.getByTestId("connect")).toBeVisible();
  await expect(win.getByTestId("connections")).toContainText("4000 De la aplicación");
  await expect(win.getByTestId("rt-messages")).toContainText("adiós");
});

test("emits Socket.IO events with auth and an ack", async () => {
  const { win } = s;
  await win.getByTestId("method").selectOption("socketio");
  await win.getByTestId("url").fill(server.url);
  await win.getByTestId("rt-tab-settings").click();
  await win.getByTestId("sio-auth").fill('{ "token": "t-123" }');
  await win.getByTestId("rt-tab-message").click();
  await win.getByTestId("connect").click();
  await expect(win.getByTestId("rt-state")).toContainText("Conectado");
  await expect(win.getByTestId("msg-in").first()).toContainText("bienvenida");
  await expect(win.getByTestId("msg-in").first()).toContainText('"token":"t-123"');

  await win.getByTestId("sio-event").fill("sumar");
  await win.getByTestId("sio-ack").check();
  await compose(win, "[2, 3, 5]");
  await win.getByTestId("send-message").click();
  await expect(win.getByTestId("msg-in").nth(1)).toContainText("ack");
  await expect(win.getByTestId("msg-in").nth(1)).toContainText("10");
  await win.screenshot({ path: resolve(shots, "socketio.png") });

  await win.getByTestId("disconnect").click();
  await expect(win.getByTestId("connect")).toBeVisible();
  await expect(win.getByTestId("rt-messages")).toContainText("Desconectado por ti");
});

test("saves a connection into a collection as a v2.1 item with x-sendix", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sendix-rt-e2e-"));
  try {
    mkdirSync(join(dir, "collections"));
    writeFileSync(
      join(dir, "collections", "Tiempo real.postman_collection.json"),
      JSON.stringify({ info: { name: "Tiempo real", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [], variable: [{ key: "ws", value: server.wsUrl }] }),
    );
    const { win, app } = s;
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
    }, dir);
    await win.getByTestId("open-workspace").click();
    await expect(win.getByTestId("tree")).toContainText("Tiempo real");

    await win.getByTestId("method").selectOption("websocket");
    await win.getByTestId("url").fill("{{ws}}/ws");
    await compose(win, '{ "tipo": "ping" }');
    await win.getByTestId("save-message").click();
    await win.keyboard.press("Control+S");
    await win.getByTestId("save-name").fill("Pedidos en vivo");
    await win.getByTestId("save-confirm").click();
    await expect(win.getByTestId("tree-request").filter({ hasText: "Pedidos en vivo" })).toContainText("WS");

    const file = join(dir, "collections", readdirSync(join(dir, "collections"))[0]!);
    const saved = JSON.parse(readFileSync(file, "utf8")).item[0];
    expect(saved.request).toMatchObject({ method: "GET", url: "{{ws}}/ws" });
    expect(saved["x-sendix"]).toMatchObject({ type: "websocket", messages: [{ body: '{ "tipo": "ping" }', language: "json" }] });

    // The collection variable resolves when connecting from the saved item.
    await win.getByTestId("connect").click();
    await expect(win.getByTestId("rt-state")).toContainText("101");
    await win.getByTestId("disconnect").click();
    await expect(win.getByTestId("connect")).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


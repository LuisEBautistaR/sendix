/** M5: gRPC calls against the local fixture server (reflection and .proto files). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { launch, shots, type Launched } from "./app";
import { PROTO_FILE, startGrpcServer, type GrpcTestServer } from "../fixtures/grpc-server";

let server: GrpcTestServer;
let s: Launched;

async function pick(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog;
  }, paths);
}

async function writeMessage(win: Page, text: string) {
  await win.getByTestId("grpc-message").click();
  await win.keyboard.press("Control+A");
  await win.keyboard.press("Delete");
  await win.keyboard.insertText(text);
}

async function chooseMethod(win: Page, method: string) {
  await win.getByTestId("grpc-method").selectOption(`tienda.v1.Tienda/${method}`);
}

test.beforeAll(async () => {
  server = await startGrpcServer();
});
test.afterAll(async () => server.close());
test.beforeEach(async () => {
  s = await launch();
});
test.afterEach(async () => s.close());

test("discovers methods by reflection and runs unary, server-stream and bidirectional calls", async () => {
  const { win } = s;
  await win.getByTestId("method").selectOption("grpc");
  await win.getByTestId("url").fill(server.target);
  await win.getByTestId("grpc-describe").or(win.getByRole("button", { name: "Cargar servicios" })).first().click();
  await expect(win.getByTestId("grpc-method").locator("option")).toHaveCount(5);

  await chooseMethod(win, "ObtenerProducto");
  await expect(win.locator(".cm-content[data-testid=grpc-message]")).toContainText('"id": ""');
  await writeMessage(win, '{ "id": "prd_1" }');
  await win.getByTestId("grpc-tab-metadata").click();
  await win.getByTestId("metadata-key-0").fill("x-tienda");
  await win.getByTestId("metadata-value-0").fill("cdmx");
  await win.getByTestId("grpc-tab-message").click();
  await win.getByTestId("grpc-invoke").click();
  await expect(win.getByTestId("grpc-status")).toHaveText("0 OK");
  await expect(win.getByTestId("grpc-body")).toContainText('"nombre": "Café de Veracruz"');
  await expect(win.getByTestId("grpc-body")).toContainText('"centavos": "18900"');
  await win.screenshot({ path: resolve(shots, "grpc-unary.png") });
  await win.getByTestId("grpc-res-metadata").click();
  await expect(win.getByTestId("grpc-response")).toContainText("x-tienda-vista");
  await expect(win.getByTestId("grpc-response")).toContainText("x-servidor");

  // A gRPC error status is shown with its name and details.
  await writeMessage(win, '{ "id": "prd_x" }');
  await win.keyboard.press("Control+Enter");
  await expect(win.getByTestId("grpc-status")).toHaveText("5 NOT_FOUND");
  await expect(win.getByTestId("grpc-status-detail")).toContainText("No existe el producto prd_x");

  await chooseMethod(win, "ListarProductos");
  await writeMessage(win, '{ "categoria": "CAFE" }');
  await win.getByTestId("grpc-invoke").click();
  await expect(win.getByTestId("grpc-status")).toHaveText("0 OK");
  await expect(win.getByTestId("grpc-msg-in")).toHaveCount(2);

  await chooseMethod(win, "Chat");
  await win.getByTestId("grpc-invoke").click();
  await expect(win.getByTestId("grpc-status")).toHaveText("Stream abierto");
  await writeMessage(win, '{ "texto": "hola" }');
  await win.getByTestId("grpc-send").click();
  await expect(win.getByTestId("grpc-msg-in")).toHaveCount(1);
  await expect(win.getByTestId("grpc-msg-in")).toContainText("eco: hola");
  await win.screenshot({ path: resolve(shots, "grpc-bidi.png") });
  await win.emulateMedia({ colorScheme: "dark" });
  await win.waitForTimeout(400); // let colour transitions finish before the capture
  await win.screenshot({ path: resolve(shots, "grpc-bidi-dark.png") });
  await win.emulateMedia({ colorScheme: "light" });
  await win.getByTestId("grpc-end").click();
  await expect(win.getByTestId("grpc-status")).toHaveText("0 OK");
});

test("loads .proto files picked by the user and refuses paths that were not picked", async () => {
  const { win, app } = s;
  await win.getByTestId("method").selectOption("grpc");
  await win.getByTestId("url").fill(server.target);
  await win.getByTestId("grpc-tab-definition").click();
  await win.getByTestId("grpc-source-files").click();
  await pick(app, [PROTO_FILE]);
  await win.getByRole("button", { name: "Añadir .proto…" }).click();
  await expect(win.getByTestId("grpc-files")).toContainText("tienda.proto");
  await win.getByTestId("grpc-describe").click();
  await expect(win.getByTestId("grpc-services")).toHaveText("1 servicio, 4 métodos");
  await win.screenshot({ path: resolve(shots, "grpc-definition.png") });

  await chooseMethod(win, "CargarPedido");
  await win.getByTestId("grpc-tab-message").click();
  await win.getByTestId("grpc-invoke").click();
  for (const qty of [1, 4]) {
    await writeMessage(win, `{ "producto_id": "prd_2", "cantidad": ${qty} }`);
    await win.getByTestId("grpc-send").click();
  }
  await win.getByTestId("grpc-end").click();
  await expect(win.getByTestId("grpc-status")).toHaveText("0 OK");
  await expect(win.getByTestId("grpc-body")).toContainText('"unidades": 5');

  // The bridge refuses a .proto path the user never picked.
  const refused = await win.evaluate(
    async ([target, file]) =>
      window.sendix.engine.call("grpc.describe", {
        request: {
          target,
          definition: { source: "files", files: [file], importPaths: [] },
          service: "",
          method: "",
          message: "{}",
          metadata: [],
          settings: { tls: "none", caFile: "", certFile: "", keyFile: "", deadlineMs: 0 },
        },
      }),
    [server.target, "C:\\Windows\\win.ini"] as const,
  );
  expect(refused).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});

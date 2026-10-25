import { describe, expect, it } from "vitest";
import { ProviderManager, type ProviderManifest } from "../../src/engine/provider-manager";
import { createRpcServer } from "../../src/engine/rpc-server";
import type { FromEngine } from "@shared/rpc";

function setup(provider: Partial<ProviderManifest> & Pick<ProviderManifest, "load">, testMode = false) {
  const sent: FromEngine[] = [];
  const manager = new ProviderManager([{ name: "system", methods: ["ping", "info"], ...provider }], { testMode, emit: () => {} });
  const server = createRpcServer({ manager, send: (m) => sent.push(m), testMode });
  const next = () => new Promise((r) => setTimeout(r, 0)).then(() => sent.at(-1));
  return { server, sent, next };
}

const pong = { ping: ({ sentAt }: any) => ({ sentAt, engineTime: 2, pid: 7, uptimeMs: 1 }) };

describe("engine RPC server", () => {
  it("answers a valid call with a validated result", async () => {
    const { server, next } = setup({ load: () => pong });
    server.handle({ kind: "call", id: "a", method: "system.ping", params: { sentAt: 1 } });
    expect(await next()).toEqual({ kind: "result", id: "a", ok: true, value: { sentAt: 1, engineTime: 2, pid: 7, uptimeMs: 1 } });
  });

  it("rejects methods outside the contract table", async () => {
    const { server, next } = setup({ load: () => pong });
    server.handle({ kind: "call", id: "b", method: "fs.readFile", params: {} });
    expect(await next()).toMatchObject({ id: "b", ok: false, error: { code: "UNKNOWN_METHOD" } });
  });

  it("rejects invalid params before reaching the provider", async () => {
    let reached = false;
    const { server, next } = setup({ load: () => ({ ping: () => ((reached = true), {}) }) });
    server.handle({ kind: "call", id: "c", method: "system.ping", params: { sentAt: "now" } });
    expect(await next()).toMatchObject({ id: "c", ok: false, error: { code: "INVALID_PARAMS" } });
    expect(reached).toBe(false);
  });

  it("refuses results that break the contract", async () => {
    const { server, next } = setup({ load: () => ({ ping: () => ({ hacked: true }) }) });
    server.handle({ kind: "call", id: "d", method: "system.ping", params: { sentAt: 1 } });
    expect(await next()).toMatchObject({ id: "d", ok: false, error: { code: "INVALID_RESULT" } });
  });

  it("reports provider exceptions as errors instead of crashing", async () => {
    const { server, next } = setup({ load: () => ({ ping: () => { throw new Error("socket closed"); } }) });
    server.handle({ kind: "call", id: "e", method: "system.ping", params: { sentAt: 1 } });
    expect(await next()).toMatchObject({ id: "e", ok: false, error: { code: "PROVIDER_FAILED", message: "socket closed" } });
  });

  it("cancels an in-flight call", async () => {
    const { server, next } = setup({
      load: () => ({ ping: (_p, { signal }) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({}))) }),
    });
    server.handle({ kind: "call", id: "f", method: "system.ping", params: { sentAt: 1 } });
    expect(server.inFlight).toBe(1);
    server.handle({ kind: "cancel", id: "f" });
    expect(await next()).toMatchObject({ id: "f", ok: false, error: { code: "CANCELLED" } });
  });

  it("does not expose test-only methods outside test mode", async () => {
    const sent: FromEngine[] = [];
    const manager = new ProviderManager([{ name: "diagnostics", methods: ["crash"], load: () => ({ crash: () => ({ scheduled: true }) }) }], { testMode: false, emit: () => {} });
    const server = createRpcServer({ manager, send: (m) => sent.push(m), testMode: false });
    server.handle({ kind: "call", id: "g", method: "diagnostics.crash", params: { exitCode: 1 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toMatchObject({ id: "g", ok: false, error: { code: "UNKNOWN_METHOD" } });
  });

  it("answers malformed envelopes that carry an id", async () => {
    const { server, next } = setup({ load: () => pong });
    server.handle({ kind: "call", id: "h" });
    expect(await next()).toMatchObject({ id: "h", ok: false, error: { code: "INVALID_ENVELOPE" } });
  });
});

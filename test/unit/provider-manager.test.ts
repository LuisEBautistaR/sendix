import { describe, expect, it, vi } from "vitest";
import { ProviderManager, type ProviderManifest } from "../../src/engine/provider-manager";

const ctx = { testMode: false, emit: () => {} };
const call = () => ({ id: "1", signal: new AbortController().signal });

describe("ProviderManager", () => {
  it("loads a provider lazily and only once", async () => {
    const load = vi.fn(() => ({ ping: () => "pong" }));
    const manager = new ProviderManager([{ name: "a", methods: ["ping"], load }], ctx);
    expect(load).not.toHaveBeenCalled();
    expect(await manager.invoke("a.ping", {}, call())).toBe("pong");
    await manager.invoke("a.ping", {}, call());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads dependencies first and hands them to the provider", async () => {
    const order: string[] = [];
    const manager = new ProviderManager(
      [
        { name: "http", methods: ["send"], dependsOn: ["cookies"], load: (deps) => (order.push("http"), { send: () => deps["cookies"]!["count"]!({}, call()) }) },
        { name: "cookies", methods: ["count"], load: () => (order.push("cookies"), { count: () => 3 }) },
      ],
      ctx,
    );
    expect(await manager.invoke("http.send", {}, call())).toBe(3);
    expect(order).toEqual(["cookies", "http"]);
  });

  it("rejects circular dependencies", () => {
    const manifests: ProviderManifest[] = [
      { name: "a", methods: [], dependsOn: ["b"], load: () => ({}) },
      { name: "b", methods: [], dependsOn: ["a"], load: () => ({}) },
    ];
    expect(() => new ProviderManager(manifests, ctx)).toThrow(/Circular provider dependency: a -> b -> a/);
  });

  it("rejects unknown dependencies and duplicate names", () => {
    expect(() => new ProviderManager([{ name: "a", methods: [], dependsOn: ["ghost"], load: () => ({}) }], ctx)).toThrow(/unknown provider "ghost"/);
    const dup: ProviderManifest = { name: "a", methods: [], load: () => ({}) };
    expect(() => new ProviderManager([dup, dup], ctx)).toThrow(/registered twice/);
  });

  it("skips test-only providers outside test mode", () => {
    const manifest: ProviderManifest = { name: "diag", methods: ["crash"], testOnly: true, load: () => ({}) };
    expect(new ProviderManager([manifest], ctx).has("diag.crash")).toBe(false);
    expect(new ProviderManager([manifest], { ...ctx, testMode: true }).has("diag.crash")).toBe(true);
  });

  it("retries a provider whose load failed", async () => {
    let attempts = 0;
    const manager = new ProviderManager(
      [{ name: "a", methods: ["go"], load: () => { attempts += 1; if (attempts === 1) throw new Error("boom"); return { go: () => "ok" }; } }],
      ctx,
    );
    await expect(manager.invoke("a.go", {}, call())).rejects.toThrow("boom");
    expect(await manager.invoke("a.go", {}, call())).toBe("ok");
  });
});

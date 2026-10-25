import type { ProviderManifest } from "../provider-manager";
import type { MethodParams, MethodResult } from "@shared/methods";

const startedAt = performance.now();

export const systemProvider: ProviderManifest = {
  name: "system",
  methods: ["ping", "info"],
  load: (_deps, ctx) => ({
    ping: (params): MethodResult<"system.ping"> => {
      const { sentAt } = params as MethodParams<"system.ping">;
      return { sentAt, engineTime: Date.now(), pid: process.pid, uptimeMs: Math.round(performance.now() - startedAt) };
    },
    info: (): MethodResult<"system.info"> => ({
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      providers: ctx.providerNames(),
    }),
  }),
};

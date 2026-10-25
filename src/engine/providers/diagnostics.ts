import type { ProviderManifest } from "../provider-manager";
import type { MethodParams, MethodResult } from "@shared/methods";

/** Test-mode only: lets end-to-end tests kill the engine and watch main restart it. */
export const diagnosticsProvider: ProviderManifest = {
  name: "diagnostics",
  methods: ["crash"],
  testOnly: true,
  load: () => ({
    crash: (params): MethodResult<"diagnostics.crash"> => {
      const { exitCode } = params as MethodParams<"diagnostics.crash">;
      // Exit after the result has been posted back.
      setTimeout(() => process.exit(exitCode), 50);
      return { scheduled: true };
    },
  }),
};

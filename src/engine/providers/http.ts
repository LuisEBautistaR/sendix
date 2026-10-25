import runtime from "postman-runtime";
import sdk from "postman-collection";
import type { ProviderManifest } from "../provider-manager";
import type { MethodParams, MethodResult } from "@shared/methods";
import { MAX_RESPONSE_BYTES, type HttpOutcome, type HttpResponse } from "@shared/http";
import { computeTimings, errorCode, mapCookies, toCollection, toCollectionItem, type HopOffsets } from "../http/convert";
import { ScriptCollector, diff, hasScripts, snapshot } from "../http/scripts";

const USER_AGENT = `Sendix/${process.env["SENDIX_VERSION"] ?? "dev"}`;
const SCRIPT_TIMEOUT_MS = 30_000;

interface ActiveRun {
  abort(): void;
}

const headersOf = (list: { all(): Array<{ key: string; value: string; disabled?: boolean }> } | undefined) =>
  (list?.all() ?? []).filter((h) => !h.disabled).map((h) => ({ key: h.key, value: String(h.value ?? "") }));

export const httpProvider: ProviderManifest = {
  name: "http",
  methods: ["send", "cancel"],
  load: () => {
    const runner = new runtime.Runner();
    const active = new Map<string, ActiveRun>();

    const send = (params: unknown, call: { signal: AbortSignal }): Promise<MethodResult<"http.send">> => {
      const { requestId, request, context = null, iterationData = null } = params as MethodParams<"http.send">;
      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);

      return new Promise((resolve) => {
        const scripts = new ScriptCollector((context?.environment ?? []).filter((v) => v.secret).map((v) => v.value));
        const collection = new sdk.Collection(toCollection(toCollectionItem(request, USER_AGENT), context));
        const environment = context
          ? new sdk.VariableScope({ values: context.environment.map((v) => ({ key: v.key, value: v.value, disabled: !v.enabled })) })
          : undefined;
        const before = { environment: snapshot(environment), collection: snapshot({ values: collection.variables }) };
        // The run copies collection variables into its own scope; scripts change that copy.
        let runState: { collectionVariables?: Parameters<typeof snapshot>[0] } | undefined;

        let settled = false;
        const finish = (outcome: HttpOutcome) => {
          if (settled) return;
          settled = true;
          active.delete(requestId);
          const report = scripts.report();
          if (outcome.kind !== "cancelled" && hasScripts(report)) outcome.scripts = report;
          if (outcome.kind !== "cancelled" && context) {
            const session = { environment: diff(before.environment, snapshot(environment)), collection: diff(before.collection, snapshot(runState?.collectionVariables)) };
            if (session.environment.length || session.collection.length) outcome.session = session;
          }
          resolve(outcome);
        };

        const options = {
          timeout: { request: request.settings.timeoutMs, script: SCRIPT_TIMEOUT_MS },
          // A failing pre-request script stops the request, as in Postman.
          stopOnError: true,
          ...(environment ? { environment } : {}),
          ...(iterationData ? { data: [iterationData] } : {}),
          requester: {
            followRedirects: request.settings.followRedirects,
            strictSSL: request.settings.verifyTls,
            timings: true,
            verbose: false,
            // No tracking headers: only what the user wrote plus standard ones.
            implicitCacheControl: false,
            implicitTraceHeader: false,
            maxResponseSize: MAX_RESPONSE_BYTES,
          },
        };

        runner.run(collection, options, (err: unknown, run: ActiveRun & { start(cb: object): void; state?: typeof runState }) => {
          runState = run?.state;
          if (err) {
            finish({ kind: "error", code: errorCode(err), message: String((err as Error).message ?? err), elapsedMs: elapsed() });
            return;
          }
          // Resolve as cancelled first, so the runtime's own abort/done callbacks find the call settled.
          const abort = () => {
            finish({ kind: "cancelled", elapsedMs: elapsed() });
            run.abort();
          };
          active.set(requestId, { abort });
          call.signal.addEventListener("abort", abort, { once: true });

          // Test scripts run after the response arrives, so the outcome is resolved in done().
          let received: HttpResponse | null = null;
          let failure: { code: string; message: string } | null = null;

          run.start({
            ...scripts.callbacks(),
            response(
              respErr: unknown,
              _cursor: unknown,
              response: any,
              sentRequest: any,
              _item: unknown,
              cookies: unknown,
              history: { execution?: { data?: Array<{ timings?: { offset?: HopOffsets } }> } } | undefined,
            ) {
              if (respErr || !response) {
                failure = { code: errorCode(respErr), message: String((respErr as Error | undefined)?.message ?? "No response") };
                return;
              }
              const hops = history?.execution?.data ?? [];
              const stream: Buffer | undefined = response.stream;
              const size = response.size?.() ?? {};
              received = {
                  status: response.code,
                  statusText: response.status ?? "",
                  headers: headersOf(response.headers),
                  cookies: mapCookies(cookies),
                  // Copy: a Buffer view may sit on a shared pool much larger than the body.
                  body: stream ? new Uint8Array(stream) : new Uint8Array(),
                  sizes: { body: stream?.byteLength ?? 0, headers: Number(size.header ?? 0) },
                  timings: computeTimings(hops.map((h) => h.timings?.offset), response.responseTime ?? elapsed()),
                  redirectCount: Math.max(0, hops.length - 1),
                  sent: {
                    method: String(sentRequest?.method ?? request.method).toUpperCase(),
                    url: String(sentRequest?.url?.toString() ?? request.url),
                    headers: headersOf(sentRequest?.headers),
                  },
              };
            },
            done(doneErr: unknown) {
              call.signal.removeEventListener("abort", abort);
              if (received) finish({ kind: "response", response: received });
              else if (failure) finish({ kind: "error", ...failure, elapsedMs: elapsed() });
              else if (doneErr) finish({ kind: "error", code: errorCode(doneErr), message: String((doneErr as Error).message ?? doneErr), elapsedMs: elapsed() });
              else if (scripts.errors.some((e) => e.phase === "prerequest"))
                finish({ kind: "error", code: "SCRIPT_ERROR", message: scripts.errors[0]?.message ?? "Script error", elapsedMs: elapsed() });
              else finish({ kind: "error", code: "NO_RESPONSE", message: "The request finished without a response", elapsedMs: elapsed() });
            },
          });
        });
      });
    };

    return {
      send,
      cancel: (params): MethodResult<"http.cancel"> => {
        const { requestId } = params as MethodParams<"http.cancel">;
        const run = active.get(requestId);
        if (!run) return { cancelled: false };
        run.abort();
        return { cancelled: true };
      },
    };
  },
};

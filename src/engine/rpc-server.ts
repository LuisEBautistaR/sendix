import { ErrorCodes, toEngineSchema, type FromEngine, type RpcError } from "@shared/rpc";
import { isMethodName, methods } from "@shared/methods";
import type { ProviderManager } from "./provider-manager";

export interface RpcServerOptions {
  manager: ProviderManager;
  send(message: FromEngine): void;
  testMode: boolean;
  log?: (message: string, detail?: unknown) => void;
}

/** Turns incoming envelopes into provider calls and always answers with a result envelope. */
export function createRpcServer({ manager, send, testMode, log = () => {} }: RpcServerOptions) {
  const inFlight = new Map<string, AbortController>();

  const fail = (id: string, error: RpcError) => send({ kind: "result", id, ok: false, error });

  async function call(id: string, method: string, rawParams: unknown): Promise<void> {
    if (!isMethodName(method) || !manager.has(method) || (methods[method].testOnly && !testMode)) {
      fail(id, { code: ErrorCodes.unknownMethod, message: `Unknown method "${method}"` });
      return;
    }
    const contract = methods[method];
    const params = contract.params.safeParse(rawParams);
    if (!params.success) {
      fail(id, { code: ErrorCodes.invalidParams, message: params.error.message });
      return;
    }
    const controller = new AbortController();
    inFlight.set(id, controller);
    try {
      const value = await manager.invoke(method, params.data, { id, signal: controller.signal });
      // Cancelled meanwhile: the CANCELLED result has already been sent.
      if (controller.signal.aborted) return;
      const result = contract.result.safeParse(value);
      if (!result.success) {
        log(`Provider returned an invalid result for ${method}`, result.error.issues);
        fail(id, { code: ErrorCodes.invalidResult, message: `Invalid result from ${method}` });
        return;
      }
      send({ kind: "result", id, ok: true, value: result.data });
    } catch (err) {
      if (controller.signal.aborted) return;
      log(`Provider failed on ${method}`, err);
      fail(id, { code: ErrorCodes.providerFailed, message: err instanceof Error ? err.message : String(err) });
    } finally {
      inFlight.delete(id);
    }
  }

  return {
    handle(raw: unknown): void {
      const parsed = toEngineSchema.safeParse(raw);
      if (!parsed.success) {
        log("Dropped an invalid envelope", parsed.error.issues);
        const id = typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string" ? raw.id : null;
        if (id) fail(id, { code: ErrorCodes.invalidEnvelope, message: "Invalid envelope" });
        return;
      }
      const message = parsed.data;
      if (message.kind === "cancel") {
        // Answer at once: the provider may not have started yet, or may ignore the signal.
        const controller = inFlight.get(message.id);
        if (controller) {
          inFlight.delete(message.id);
          controller.abort();
          fail(message.id, { code: ErrorCodes.cancelled, message: "Call was cancelled" });
        }
        return;
      }
      void call(message.id, message.method, message.params);
    },
    get inFlight(): number {
      return inFlight.size;
    },
  };
}

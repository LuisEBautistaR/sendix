/**
 * Providers are the engine's units of capability (http, ws, grpc, cookies…).
 * Each declares a manifest: its name, the methods it exposes and the providers it
 * depends on. A provider is loaded only when one of its methods is first called,
 * after its dependencies; cycles and unknown dependencies are rejected up front.
 */

export interface ProviderContext {
  /** Push an event to main (status changes, streamed messages). */
  emit(stream: string, name: string, data: unknown): void;
  testMode: boolean;
  /** Names of every registered provider. */
  providerNames(): string[];
}

export interface CallContext {
  id: string;
  signal: AbortSignal;
}

export type ProviderMethod = (params: unknown, call: CallContext) => unknown;
export type ProviderInstance = Readonly<Record<string, ProviderMethod>>;

export interface ProviderManifest {
  name: string;
  methods: readonly string[];
  dependsOn?: readonly string[];
  /** Registered only when the engine runs in test mode. */
  testOnly?: boolean;
  load(deps: Readonly<Record<string, ProviderInstance>>, ctx: ProviderContext): ProviderInstance | Promise<ProviderInstance>;
}

export class ProviderManager {
  readonly #manifests = new Map<string, ProviderManifest>();
  readonly #methodOwner = new Map<string, ProviderManifest>();
  readonly #instances = new Map<string, Promise<ProviderInstance>>();
  readonly #ctx: Omit<ProviderContext, "providerNames">;

  constructor(manifests: readonly ProviderManifest[], ctx: Omit<ProviderContext, "providerNames">) {
    this.#ctx = ctx;
    for (const manifest of manifests) {
      if (manifest.testOnly && !ctx.testMode) continue;
      if (this.#manifests.has(manifest.name)) {
        throw new Error(`Provider "${manifest.name}" is registered twice`);
      }
      this.#manifests.set(manifest.name, manifest);
      for (const method of manifest.methods) {
        const qualified = `${manifest.name}.${method}`;
        this.#methodOwner.set(qualified, manifest);
      }
    }
    for (const manifest of this.#manifests.values()) this.#checkDependencies(manifest.name, []);
  }

  #checkDependencies(name: string, chain: string[]): void {
    if (chain.includes(name)) {
      throw new Error(`Circular provider dependency: ${[...chain, name].join(" -> ")}`);
    }
    const manifest = this.#manifests.get(name);
    if (!manifest) {
      throw new Error(`Provider "${chain.at(-1)}" depends on unknown provider "${name}"`);
    }
    for (const dep of manifest.dependsOn ?? []) this.#checkDependencies(dep, [...chain, name]);
  }

  providerNames(): string[] {
    return [...this.#manifests.keys()];
  }

  has(method: string): boolean {
    return this.#methodOwner.has(method);
  }

  async invoke(method: string, params: unknown, call: CallContext): Promise<unknown> {
    const manifest = this.#methodOwner.get(method);
    if (!manifest) throw new Error(`Unknown method "${method}"`);
    const instance = await this.#load(manifest.name);
    const name = method.slice(manifest.name.length + 1);
    const fn = instance[name];
    if (typeof fn !== "function") {
      throw new Error(`Provider "${manifest.name}" does not implement "${name}"`);
    }
    return fn(params, call);
  }

  #load(name: string): Promise<ProviderInstance> {
    let pending = this.#instances.get(name);
    if (!pending) {
      const manifest = this.#manifests.get(name)!;
      pending = (async () => {
        const deps: Record<string, ProviderInstance> = {};
        for (const dep of manifest.dependsOn ?? []) deps[dep] = await this.#load(dep);
        return manifest.load(deps, { ...this.#ctx, providerNames: () => this.providerNames() });
      })();
      // A failed load is retried on the next call instead of being cached forever.
      pending.catch(() => this.#instances.delete(name));
      this.#instances.set(name, pending);
    }
    return pending;
  }
}

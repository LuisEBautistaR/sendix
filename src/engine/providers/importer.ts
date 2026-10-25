import type { ProviderManifest } from "../provider-manager";
import type { MethodParams, MethodResult } from "@shared/methods";

interface ConvertResult {
  result: boolean;
  reason?: string;
  output?: Array<{ type: string; data: Record<string, unknown> }>;
}

export const importerProvider: ProviderManifest = {
  name: "import",
  methods: ["openapi"],
  load: async () => {
    // Loaded on first use: the converter is large and most sessions never import.
    const { default: converter } = (await import("openapi-to-postmanv2")) as unknown as {
      default: { convert(input: object, options: object, cb: (err: Error | null, res: ConvertResult) => void): void };
    };
    return {
      openapi: (params): Promise<MethodResult<"import.openapi">> => {
        const { text } = params as MethodParams<"import.openapi">;
        return new Promise((resolve, reject) => {
          converter.convert(
            { type: "string", data: text },
            { folderStrategy: "Tags", requestNameSource: "Fallback", includeAuthInfoInExample: false, schemaFaker: true },
            (err, res) => {
              if (err) return reject(err);
              const collection = res.output?.find((o) => o.type === "collection")?.data;
              if (!res.result || !collection) return reject(new Error(res.reason ?? "La definición OpenAPI no es válida"));
              resolve({ collection, warnings: [] });
            },
          );
        });
      },
    };
  },
};

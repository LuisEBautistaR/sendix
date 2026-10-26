/** JSONPath for JSON responses: jsonpath-plus in its "safe" mode, which needs no eval and so works under the CSP. */
import { JSONPath } from "jsonpath-plus";

export type FilterResult = { ok: true; text: string; count: number } | { ok: false; error: string };

export function filterJson(text: string, path: string): FilterResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "La respuesta no es JSON válido." };
  }
  try {
    const matches = JSONPath({ path, json: json as object, eval: "safe", wrap: true }) as unknown[];
    return { ok: true, text: JSON.stringify(matches, null, 2), count: matches.length };
  } catch (err) {
    return { ok: false, error: `Expresión JSONPath no válida: ${(err as Error).message}` };
  }
}

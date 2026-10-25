import type { KeyValue } from "@shared/http";

/**
 * The URL is the source of truth for the query string; the parameter table mirrors it.
 * Values are kept exactly as typed (no encoding/decoding) so editing round-trips.
 */
export function splitUrl(url: string): { base: string; query: KeyValue[]; hash: string } {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf("?");
  if (queryAt < 0) return { base: beforeHash, query: [], hash };
  const query = beforeHash
    .slice(queryAt + 1)
    .split("&")
    .filter((part) => part !== "")
    .map((part) => {
      const eq = part.indexOf("=");
      return eq < 0
        ? { key: part, value: "", enabled: true }
        : { key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true };
    });
  return { base: beforeHash.slice(0, queryAt), query, hash };
}

export function buildUrl(base: string, params: readonly KeyValue[], hash = ""): string {
  const query = params
    .filter((p) => p.enabled && (p.key !== "" || p.value !== ""))
    .map((p) => (p.value === "" ? p.key : `${p.key}=${p.value}`))
    .join("&");
  return `${base}${query ? `?${query}` : ""}${hash}`;
}

/**
 * New parameter table after the URL was edited: enabled rows come from the URL,
 * disabled rows the user kept (unchecked) survive, descriptions are carried over by key.
 */
export function paramsFromUrl(url: string, previous: readonly KeyValue[]): KeyValue[] {
  const fromUrl = splitUrl(url).query.map((p) => {
    const old = previous.find((o) => o.enabled && o.key === p.key);
    return old?.description ? { ...p, description: old.description } : p;
  });
  return [...fromUrl, ...previous.filter((p) => !p.enabled)];
}

/** Adds http:// when the user typed a bare host, as API clients usually do. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  // A leading variable ({{base}}) carries its own scheme.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("{{")) return trimmed;
  return `http://${trimmed}`;
}

/** Short label for a request: last path segment, or the host. */
export function requestName(url: string): string {
  const { base } = splitUrl(url.trim());
  const path = base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "Nueva petición";
  return parts.length === 1 ? parts[0]! : `/${parts.slice(1).join("/")}`;
}

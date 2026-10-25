import { useEffect, useState } from "react";
import type { HttpRequest } from "@shared/http";
import type { HistoryEntry } from "@shared/ipc";
import type { VariableView } from "@shared/workspace";
import { withScheme } from "../lib/url";
import { resolvePreview, undefinedVariables } from "../lib/vars";
import { useStore } from "../state/store";
import { clockTime, formatBytes, formatMs } from "../lib/format";

const mask = (value: string) => (value ? "••••••••" : "");

/** What the request will look like on the wire, before system headers (shown exactly after sending, in Cronología). */
function previewLines(draft: HttpRequest, vars: readonly VariableView[]): Array<[string, string]> {
  const r = (text: string) => resolvePreview(text, vars);
  let target = r(draft.url.trim());
  let host = "";
  try {
    const u = new URL(withScheme(target));
    host = u.host;
    target = `${u.pathname}${u.search}`;
  } catch {
    /* show the raw text while the URL is incomplete */
  }
  const lines: Array<[string, string]> = [];
  if (host) lines.push(["Host", host]);
  const auth = draft.auth;
  if (auth.type === "bearer") lines.push(["Authorization", `Bearer ${mask(auth.token)}`]);
  if (auth.type === "basic") lines.push(["Authorization", `Basic ${mask(auth.username + auth.password)}`]);
  if (auth.type === "apikey" && auth.in === "header" && auth.key) lines.push([r(auth.key), mask(auth.value)]);
  if (auth.type === "inherit") lines.push(["Authorization", "(heredada de la carpeta o colección)"]);
  if (auth.type === "preserved") lines.push(["Authorization", `(${auth.label}, definida en el archivo)`]);
  for (const h of draft.headers) if (h.enabled && h.key.trim()) lines.push([r(h.key.trim()), r(h.value)]);
  const hasType = draft.headers.some((h) => h.enabled && h.key.trim().toLowerCase() === "content-type");
  if (!hasType && draft.body.mode === "raw") {
    const types = { json: "application/json", text: "text/plain", xml: "application/xml", html: "text/html", javascript: "application/javascript" } as const;
    lines.push(["Content-Type", types[draft.body.language]]);
  }
  if (!hasType && draft.body.mode === "urlencoded") lines.push(["Content-Type", "application/x-www-form-urlencoded"]);
  if (!hasType && draft.body.mode === "formdata") lines.push(["Content-Type", "multipart/form-data"]);
  return [[`${draft.method.toUpperCase()} ${target || "/"}`, ""], ...lines];
}

function useRunsOf(draft: HttpRequest): HistoryEntry[] {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void window.sendix.history.list().then((list) => alive && list && setEntries(list));
    load();
    const off = window.sendix.history.onChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  const url = withScheme(draft.url);
  return entries.filter((e) => e.method === draft.method.toUpperCase() && e.url === url).slice(0, 5);
}

/** Fills the space under the parameter table with what the user needs before and after sending. */
export function RequestInsights({ draft }: { draft: HttpRequest }) {
  const runs = useRunsOf(draft);
  const vars = useStore((s) => s.variables);
  const hasWorkspace = useStore((s) => s.workspace !== null);
  if (draft.url.trim() === "") return null;
  const [first, ...headers] = previewLines(draft, vars);
  const bodyText = draft.body.mode === "raw" ? [draft.body.raw] : draft.body.mode === "urlencoded" || draft.body.mode === "formdata" ? draft.body.fields.map((f) => f.value) : [];
  const missing = undefinedVariables([draft.url, ...draft.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value]), ...bodyText], vars);
  return (
    <>
      <div className="section-label">
        Petición resuelta <span>vista previa; al enviar se añaden User-Agent y Accept</span>
      </div>
      {missing.length > 0 && (
        <p className="notice warn" data-testid="missing-variables">
          {missing.length === 1 ? "Variable sin valor" : "Variables sin valor"}: {missing.map((m) => `{{${m}}}`).join(", ")}.{" "}
          {hasWorkspace ? "Defínela en el entorno activo o en la colección." : "Abre una carpeta de trabajo y define un entorno."}
        </p>
      )}
      <div className="code-block">
        <pre className="code flush" data-testid="resolved-request">
          <span className="ln">
            <span className="t-kw">{first![0].split(" ")[0]}</span> {first![0].split(" ").slice(1).join(" ")}
          </span>
          {headers.map(([k, v], i) => (
            <span className="ln" key={i}>
              <span className="t-key">{k}</span>
              <span className="t-punct">:</span> {v}
            </span>
          ))}
        </pre>
      </div>
      {runs.length > 0 && (
        <>
          <div className="section-label">
            Últimas ejecuciones <span>de esta misma petición</span>
          </div>
          <table className="kv readonly runs" data-testid="recent-runs">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Estado</th>
                <th>Tiempo</th>
                <th>Tamaño</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{clockTime(r.at)}</td>
                  <td>
                    <span className={`st ${r.status == null || r.status >= 400 ? "err" : r.status < 300 ? "ok" : ""}`}>
                      {r.status != null ? `${r.status} ${r.statusText ?? ""}` : r.error}
                    </span>
                  </td>
                  <td className="mono">{r.durationMs != null ? formatMs(r.durationMs) : "—"}</td>
                  <td className="mono">{r.sizeBytes != null ? formatBytes(r.sizeBytes) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

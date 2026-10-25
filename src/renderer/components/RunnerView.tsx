import { Fragment, useMemo, useRef } from "react";
import type { TreeNode } from "@shared/collection";
import { DataFileError, parseDataFile } from "@shared/data-file";
import { MAX_ITERATIONS } from "@shared/runner";
import { resultFailed, useStore, type RunnerTab } from "../state/store";
import { explainError, formatMs } from "../lib/format";
import { Icon } from "../Icon";
import { methodClass } from "./RequestPane";
import { ConsoleList, ScriptErrors, testSummary } from "./ScriptResults";

const MAX_DATA_BYTES = 20 * 1024 * 1024;

interface PlannedRequest {
  id: string;
  name: string;
  method: string;
  path: string[];
}

function planned(nodes: readonly TreeNode[], path: string[] = []): PlannedRequest[] {
  return nodes.flatMap((n) =>
    n.kind === "request" ? [{ id: n.id, name: n.name, method: n.method ?? "GET", path }] : planned(n.children ?? [], [...path, n.name]),
  );
}

function findNode(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children ?? [], id);
    if (found) return found;
  }
  return null;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

export function RunnerView({ tab }: { tab: RunnerTab }) {
  const { patchRunner, startRun, stopRun, notify } = useStore.getState();
  const collection = useStore((s) => s.workspace?.collections.find((c) => c.id === tab.collectionId));
  const folder = collection && tab.folderId ? findNode(collection.tree, tab.folderId) : null;
  const requests = useMemo(() => (collection ? planned(folder ? (folder.children ?? []) : collection.tree) : []), [collection, folder]);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = tab.status !== "idle";

  const loadData = async (file: File) => {
    if (file.size > MAX_DATA_BYTES) return notify("err", "El archivo de datos supera 20 MB.");
    try {
      const parsed = parseDataFile(await file.text(), file.name);
      if (!parsed.rows.length) return notify("err", "El archivo no tiene filas de datos.");
      patchRunner(tab.id, { data: { ...parsed, name: file.name }, iterations: Math.min(parsed.rows.length, MAX_ITERATIONS) });
    } catch (err) {
      notify("err", err instanceof DataFileError ? err.message : "No se pudo leer el archivo de datos.");
    }
  };

  const total = tab.plan ? tab.plan.requests * tab.plan.iterations : requests.length * tab.iterations;
  const done = tab.results.length;
  const tests = testSummary(tab.results.flatMap((r) => r.tests));
  const failedRequests = tab.results.filter(resultFailed).length;
  const avg = done ? tab.results.reduce((sum, r) => sum + r.durationMs, 0) / done : 0;
  const rows = tab.onlyFailures ? tab.results.filter(resultFailed) : tab.results;
  const hasRun = tab.startedAt !== null;

  return (
    <section className="screen runner" data-testid="runner">
      <div className="runner-head">
        <div className="runner-title">
          <Icon name="run" size={14} />
          <span>
            Ejecutar <b>{collection?.name ?? "Colección"}</b>
            {folder && <> / {folder.name}</>}
          </span>
          <span className="muted">
            {requests.length} {requests.length === 1 ? "petición" : "peticiones"}
          </span>
        </div>
        <div className="runner-config">
          <label className="mini-field">
            <span>Iteraciones</span>
            <input
              className="mono"
              type="number"
              min={1}
              max={MAX_ITERATIONS}
              value={tab.iterations}
              disabled={busy}
              onChange={(e) => patchRunner(tab.id, { iterations: clamp(Number(e.target.value), 1, MAX_ITERATIONS) })}
              data-testid="runner-iterations"
            />
          </label>
          <label className="mini-field">
            <span>Retraso</span>
            <input className="mono" type="number" min={0} max={60000} step={100} value={tab.delayMs} disabled={busy} onChange={(e) => patchRunner(tab.id, { delayMs: clamp(Number(e.target.value), 0, 60000) })} />
            <span className="unit">ms</span>
          </label>
          <span className="mini-field">
            <span>Datos</span>
            {tab.data ? (
              <span className="data-chip" title={tab.data.columns.join(", ")} data-testid="runner-data">
                <span className="mono">{tab.data.name}</span>
                <span className="muted">
                  {tab.data.rows.length} {tab.data.rows.length === 1 ? "fila" : "filas"} · {tab.data.columns.length} columnas
                </span>
                <button type="button" className="icon-btn" aria-label="Quitar el archivo de datos" disabled={busy} onClick={() => patchRunner(tab.id, { data: null })}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ) : (
              <button type="button" className="link-btn" disabled={busy} onClick={() => fileInput.current?.click()} data-testid="runner-pick-data">
                Elegir CSV o JSON…
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              hidden
              data-testid="runner-data-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void loadData(file);
              }}
            />
          </span>
          <span className="end">
            {busy ? (
              <button type="button" className="btn btn-secondary" disabled={tab.status === "stopping"} onClick={() => void stopRun(tab.id)} data-testid="runner-stop">
                {tab.status === "stopping" ? "Deteniendo…" : "Detener"}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!requests.length} onClick={() => void startRun(tab.id)} data-testid="runner-start">
                {hasRun ? "Ejecutar de nuevo" : "Ejecutar"}
              </button>
            )}
          </span>
        </div>
        {tab.data && tab.iterations > tab.data.rows.length && (
          <p className="hint runner-note">Hay más iteraciones que filas: desde la iteración {tab.data.rows.length + 1} se repite la última fila.</p>
        )}
      </div>

      {hasRun && (
        <div className="runner-summary" data-testid="runner-summary">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Progreso">
            <i style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} className={failedRequests ? "bad" : ""} />
          </div>
          <div className="runner-stats">
            <span>
              Peticiones <b>{done}</b>/{total}
            </span>
            <span className={tests.failed ? "err" : tests.total ? "ok" : ""}>
              Tests <b>{tests.passed}</b>/{tests.total}
              {tests.failed > 0 && <> · {tests.failed} fallaron</>}
            </span>
            <span className={failedRequests ? "err" : ""}>
              Con fallos <b>{failedRequests}</b>
            </span>
            <span>
              Tiempo medio <b>{formatMs(avg)}</b>
            </span>
            <span className="state" data-testid="runner-state">
              {busy ? (tab.status === "stopping" ? "Deteniendo…" : "En curso…") : tab.finish?.error ? `Error: ${tab.finish.error}` : tab.finish?.stopped ? "Detenida" : "Terminada"}
              {tab.finishedAt && tab.startedAt ? ` en ${formatMs(tab.finishedAt - tab.startedAt)}` : ""}
            </span>
            <span className="seg end" role="radiogroup" aria-label="Filtro de resultados">
              <button type="button" role="radio" aria-checked={!tab.onlyFailures} aria-pressed={!tab.onlyFailures} onClick={() => patchRunner(tab.id, { onlyFailures: false })}>
                Todas
              </button>
              <button type="button" role="radio" aria-checked={tab.onlyFailures} aria-pressed={tab.onlyFailures} onClick={() => patchRunner(tab.id, { onlyFailures: true })}>
                Con fallos
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="pane-body">
        {!hasRun ? (
          <Plan requests={requests} tab={tab} />
        ) : (
          <table className="kv readonly run-table" data-testid="runner-results">
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: 54 }} />
              <col />
              <col style={{ width: 120 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Iter.</th>
                <th>Petición</th>
                <th>Estado</th>
                <th>Tiempo</th>
                <th>Tests</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = testSummary(r.tests);
                const failed = resultFailed(r);
                const open = tab.expanded === r.sequence;
                return (
                  <Fragment key={r.sequence}>
                    <tr className={`run-row${failed ? " failed" : ""}${open ? " open" : ""}`} onClick={() => patchRunner(tab.id, { expanded: open ? null : r.sequence })} data-testid="run-row">
                      <td className="mono muted">{r.sequence + 1}</td>
                      <td className="mono muted">{r.iteration}</td>
                      <td>
                        <button type="button" className="run-name" aria-expanded={open}>
                          <Icon name={open ? "down" : "right"} size={12} />
                          <span className={`meth ${methodClass(r.method)}`}>{r.method === "DELETE" ? "DEL" : r.method}</span>
                          <span>{r.name}</span>
                          {r.path.length > 0 && <span className="muted">{r.path.join(" / ")}</span>}
                        </button>
                      </td>
                      <td className={`mono ${r.status === null ? "err" : r.status >= 400 ? "err" : "ok"}`}>{r.status ?? r.error}</td>
                      <td className="mono">{formatMs(r.durationMs)}</td>
                      <td className={`mono ${t.failed || r.errors.length ? "err" : t.total ? "ok" : "muted"}`}>{t.total ? `${t.passed}/${t.total}` : r.errors.length ? "error" : "—"}</td>
                    </tr>
                    {open && (
                      <tr className="run-detail">
                        <td colSpan={6}>
                          <RunDetail result={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {tab.onlyFailures ? "Ninguna petición ha fallado." : "Esperando la primera respuesta…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function RunDetail({ result }: { result: RunnerTab["results"][number] }) {
  return (
    <div className="run-detail-body">
      <p className="mono url-line">
        {result.method} {result.url}
      </p>
      {result.status === null && result.error && <p className="notice warn">{explainError(result.error)} {result.message && <span className="mono">{result.message}</span>}</p>}
      <ScriptErrors errors={result.errors} />
      {result.tests.length > 0 && (
        <ul className="tests">
          {result.tests.map((t, i) => (
            <li key={i} className={t.skipped ? "skip" : t.passed ? "pass" : "fail"}>
              <span className="badge">{t.skipped ? "OMITIDO" : t.passed ? "PASA" : "FALLA"}</span>
              <span className="name">{t.name || "(sin nombre)"}</span>
              {t.error && <span className="why mono">{t.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {result.console.length > 0 && <ConsoleList entries={result.console} />}
      {!result.tests.length && !result.console.length && !result.errors.length && result.status !== null && <p className="hint">Sin tests ni salida de consola.</p>}
    </div>
  );
}

function Plan({ requests, tab }: { requests: PlannedRequest[]; tab: RunnerTab }) {
  if (!requests.length) return <p className="hint pad">No hay peticiones que ejecutar aquí.</p>;
  const preview = tab.data?.rows.slice(0, 5) ?? [];
  return (
    <>
      <div className="section-label">
        Orden de ejecución <span>cada iteración envía estas peticiones en este orden; lo que guardan los scripts pasa a la siguiente</span>
      </div>
      <ol className="plan" data-testid="runner-plan">
        {requests.map((r, i) => (
          <li key={r.id}>
            <span className="mono muted">{i + 1}</span>
            <span className={`meth ${methodClass(r.method)}`}>{r.method === "DELETE" ? "DEL" : r.method}</span>
            <span>{r.name}</span>
            {r.path.length > 0 && <span className="muted">{r.path.join(" / ")}</span>}
          </li>
        ))}
      </ol>
      {tab.data && (
        <>
          <div className="section-label">
            Datos <span>cada fila alimenta una iteración: úsala como {"{{columna}}"} o con pm.iterationData.get("columna")</span>
          </div>
          <div className="data-preview">
            <table className="kv readonly">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Fila</th>
                  {tab.data.columns.map((c) => (
                    <th key={c} className="mono">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="mono muted">{i + 1}</td>
                    {tab.data!.columns.map((c) => (
                      <td key={c} className="mono">
                        {row[c] === undefined ? "" : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {tab.data.rows.length > preview.length && <p className="hint pad">y {tab.data.rows.length - preview.length} filas más.</p>}
          </div>
        </>
      )}
    </>
  );
}

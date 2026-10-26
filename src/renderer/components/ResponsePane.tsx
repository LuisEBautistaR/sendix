import { useEffect, useMemo, useRef, useState } from "react";
import type { HttpResponse, ScriptReport, Timings } from "@shared/http";
import { useStore, type BodyFormat, type BodyView, type RequestTab, type ResponsePanel } from "../state/store";
import { decodeBody } from "../lib/body";
import { clockTime, explainError, formatBytes, formatMs, isTlsError } from "../lib/format";
import { Icon } from "../Icon";
import { CodeViewer, type CodeViewerHandle, type ViewerLanguage } from "./CodeViewer";
import { filterJson, filterXml, prettyXml } from "../lib/filter";
import { ConsoleList, ScriptErrors, TestList, testSummary } from "./ScriptResults";

const STATUS_TEXT_FALLBACK: Record<number, string> = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" };

function statusTone(status: number): "ok" | "err" | "neutral" {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400) return "err";
  return "neutral";
}

/** The signature strata bar: one stone layer per timing phase, widths proportional to time. */
export function Strata({ timings, note }: { timings: Timings; note?: string }) {
  const layers: Array<[string, number, number]> = [
    ["Redirecciones", timings.redirects, 0],
    ["DNS", timings.dns, 1],
    ["TCP", timings.tcp, 2],
    ["TLS", timings.tls, 3],
    ["Espera", timings.wait, 4],
    ["Descarga", timings.download, 5],
  ].filter(([, ms]) => (ms as number) > 0) as Array<[string, number, number]>;
  const label = layers.map(([n, ms]) => `${n} ${formatMs(ms)}`).join(", ");
  return (
    <div className="strata" data-testid="strata">
      <div className="strata-bar" role="img" aria-label={`Desglose de tiempos: ${label || "sin datos"}`}>
        {layers.map(([name, ms, tone]) => (
          <i key={name} className={`s${tone}`} style={{ flexGrow: ms }} title={`${name} ${formatMs(ms)}`} />
        ))}
      </div>
      <div className="strata-legend">
        {layers.map(([name, ms, tone]) => (
          <span key={name} className={`s${tone}`}>
            {name} <b>{formatMs(ms)}</b>
          </span>
        ))}
        <span className="note">
          {note ? `${note} · ` : ""}total <b>{formatMs(timings.total)}</b>
        </span>
      </div>
    </div>
  );
}

export function ResponsePane({ tab }: { tab: RequestTab }) {
  if (tab.status === "sending") return <Sending tab={tab} />;
  if (tab.rpcError) return <Failure code={tab.rpcError.code} message={tab.rpcError.message} tab={tab} />;
  const outcome = tab.outcome;
  if (!outcome) return <EmptyResponse />;
  if (outcome.kind === "cancelled") {
    return (
      <div className="pane response-state" data-testid="response-cancelled">
        <p className="state-title">Petición cancelada</p>
        <p className="muted">Se detuvo tras {formatMs(outcome.elapsedMs)}. Pulsa Enviar para repetirla.</p>
      </div>
    );
  }
  if (outcome.kind === "error") return <Failure code={outcome.code} message={outcome.message} tab={tab} elapsedMs={outcome.elapsedMs} scripts={outcome.scripts} />;
  return <ResponseView tab={tab} response={outcome.response} scripts={outcome.scripts} />;
}

function Sending({ tab }: { tab: RequestTab }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pane response-state" data-testid="response-sending" aria-live="polite">
      <div className="strata-bar sending" aria-hidden="true">
        <i />
      </div>
      <p className="state-title">Enviando… {tab.sentAt ? formatMs(now - tab.sentAt) : ""}</p>
      <p className="muted">
        Tiempo máximo {formatMs(tab.draft.settings.timeoutMs)}. Puedes cancelar con el botón Cancelar.
      </p>
    </div>
  );
}

function Failure({ code, message, tab, elapsedMs, scripts }: { code: string; message: string; tab: RequestTab; elapsedMs?: number; scripts?: ScriptReport | undefined }) {
  return (
    <div className="pane response-state" data-testid="response-error">
      <p className="state-title err">{code === "SCRIPT_ERROR" ? "La petición no se envió" : "No hubo respuesta"}</p>
      <p>{explainError(code, tab.lastTimeoutMs ?? undefined)}</p>
      {isTlsError(code) && <TlsActions tab={tab} />}
      <dl className="facts compact">
        <dt>Código</dt>
        <dd className="mono" data-testid="error-code">{code}</dd>
        <dt>Detalle</dt>
        <dd className="mono">{message}</dd>
        {elapsedMs !== undefined && (
          <>
            <dt>Tras</dt>
            <dd className="mono">{formatMs(elapsedMs)}</dd>
          </>
        )}
      </dl>
      {scripts && code !== "SCRIPT_ERROR" && <ScriptErrors errors={scripts.errors} />}
      {scripts && scripts.console.length > 0 && (
        <>
          <div className="section-label flush">Consola</div>
          <ConsoleList entries={scripts.console} />
        </>
      )}
    </div>
  );
}

/** Quick ways out of a certificate error: send this one without verification, or fix it for good in Settings. */
function TlsActions({ tab }: { tab: RequestTab }) {
  const { setDraft, send, openSettings } = useStore.getState();
  return (
    <div className="state-actions">
      {tab.draft.settings.verifyTls && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setDraft(tab.id, (d) => ({ ...d, settings: { ...d.settings, verifyTls: false } }));
            void send(tab.id);
          }}
          data-testid="tls-send-insecure"
        >
          Reenviar sin verificar esta petición
        </button>
      )}
      <button type="button" className="link-btn" onClick={openSettings} data-testid="tls-open-settings">
        CA y certificados de cliente en Ajustes
      </button>
    </div>
  );
}

function EmptyResponse() {
  return (
    <div className="pane response-state" data-testid="response-empty">
      <p className="state-title">Aún no hay respuesta</p>
      <p className="muted">Escribe una URL y envía la petición. Verás el estado, el cuerpo, las cabeceras y el desglose de tiempos.</p>
      <ul className="shortcuts">
        <li><kbd>Ctrl</kbd> <kbd>↵</kbd> Enviar</li>
        <li><kbd>Ctrl</kbd> <kbd>T</kbd> Nueva pestaña</li>
        <li><kbd>Ctrl</kbd> <kbd>W</kbd> Cerrar pestaña</li>
        <li><kbd>Ctrl</kbd> <kbd>L</kbd> Ir a la URL</li>
      </ul>
    </div>
  );
}

const PANELS: Array<{ id: ResponsePanel; label: string }> = [
  { id: "body", label: "Cuerpo" },
  { id: "headers", label: "Cabeceras" },
  { id: "cookies", label: "Cookies" },
  { id: "tests", label: "Tests" },
  { id: "console", label: "Consola" },
  { id: "timeline", label: "Cronología" },
];

function ResponseView({ tab, response, scripts }: { tab: RequestTab; response: HttpResponse; scripts: ScriptReport | undefined }) {
  const { patch } = useStore.getState();
  const tone = statusTone(response.status);
  const statusText = response.statusText || STATUS_TEXT_FALLBACK[response.status] || "";
  const tests = testSummary(scripts?.tests ?? []);
  const scriptFailed = tests.failed > 0 || (scripts?.errors.length ?? 0) > 0;
  const counts: Partial<Record<ResponsePanel, string | number>> = {
    headers: response.headers.length,
    cookies: response.cookies.length,
    ...(tests.total ? { tests: `${tests.passed}/${tests.total}` } : scripts?.errors.length ? { tests: "error" } : {}),
    ...(scripts?.console.length ? { console: scripts.console.length } : {}),
  };
  const note = response.redirectCount > 0 ? `${response.redirectCount} redirección${response.redirectCount > 1 ? "es" : ""}` : undefined;

  return (
    <div className="pane" data-testid="response">
      <div className="resp-head">
        <div className="status-line">
          <span className={`status ${tone}`} data-testid="status">
            <span className="code-n">{response.status}</span> {statusText}
          </span>
          <span className="metric">
            Tiempo <b>{formatMs(response.timings.total)}</b>
          </span>
          <span className="metric">
            Tamaño <b>{formatBytes(response.sizes.body)}</b>
          </span>
          {tests.total > 0 && (
            <button type="button" className={`metric tests-chip ${tests.failed ? "bad" : "good"}`} onClick={() => patch(tab.id, { responsePanel: "tests" })} data-testid="tests-chip">
              Tests <b>{tests.passed}/{tests.total}</b>
            </button>
          )}
          <span className="metric">{tab.sentAt ? clockTime(tab.sentAt) : ""}</span>
        </div>
        <Strata timings={response.timings} {...(note ? { note } : {})} />
      </div>
      <div className="subtabs" role="tablist" aria-label="Partes de la respuesta">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            className="subtab"
            aria-selected={tab.responsePanel === p.id}
            data-testid={`res-tab-${p.id}`}
            onClick={() => patch(tab.id, { responsePanel: p.id })}
          >
            {p.label} {counts[p.id] ? <span className={`n${p.id === "tests" && scriptFailed ? " bad" : ""}`}>{counts[p.id]}</span> : null}
          </button>
        ))}
      </div>
      {tab.responsePanel === "body" && <BodyPanel tab={tab} response={response} />}
      {tab.responsePanel === "headers" && <HeaderList rows={response.headers} testId="response-headers" />}
      {tab.responsePanel === "cookies" && <CookieList response={response} />}
      {tab.responsePanel === "tests" && <TestList report={scripts} />}
      {tab.responsePanel === "console" && <ConsoleList entries={scripts?.console ?? []} />}
      {tab.responsePanel === "timeline" && <Timeline response={response} />}
    </div>
  );
}

const FORMATS: Array<[BodyFormat, string]> = [
  ["auto", "Automático"],
  ["json", "JSON"],
  ["xml", "XML"],
  ["html", "HTML"],
  ["text", "Texto"],
];

function BodyPanel({ tab, response }: { tab: RequestTab; response: HttpResponse }) {
  const { patch } = useStore.getState();
  const decoded = useMemo(() => decodeBody(response.body, response.headers, tab.bodyFormat), [response, tab.bodyFormat]);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const viewer = useRef<CodeViewerHandle>(null);
  const textual = decoded.kind === "json" || decoded.kind === "xml" || decoded.kind === "html" || decoded.kind === "text";
  const canPreview = decoded.kind === "image" || decoded.kind === "html";
  const views: Array<[BodyView, string]> = [
    ["pretty", "Formateado"],
    ["raw", "Crudo"],
    ...(canPreview ? ([["preview", "Vista previa"]] as Array<[BodyView, string]>) : []),
  ];
  const view: BodyView = decoded.kind === "image" ? (tab.bodyView === "raw" ? "raw" : "preview") : tab.bodyView === "preview" && !canPreview ? "pretty" : tab.bodyView;
  const pretty = useMemo(() => (decoded.kind === "xml" ? prettyXml(decoded.text) : decoded.pretty), [decoded]);
  const filterable = view === "pretty" && (decoded.kind === "json" || decoded.kind === "xml");
  const expression = filterable ? tab.bodyFilter.trim() : "";
  const filtered = useMemo(() => (expression ? (decoded.kind === "json" ? filterJson(decoded.text, expression) : filterXml(decoded.text, expression)) : null), [decoded, expression]);
  const shown = filtered?.ok ? filtered.text : view === "pretty" && pretty ? pretty : decoded.text;
  const language: ViewerLanguage = view === "raw" ? "text" : decoded.kind === "json" || decoded.kind === "xml" || decoded.kind === "html" ? decoded.kind : "text";

  return (
    <>
      <div className="toolbar">
        <span className="seg">
          {views.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => patch(tab.id, { bodyView: id })} data-testid={`body-view-${id}`}>
              {label}
            </button>
          ))}
        </span>
        <select className="mini-select" value={tab.bodyFormat} onChange={(e) => patch(tab.id, { bodyFormat: e.target.value as BodyFormat })} aria-label="Leer el cuerpo como" title="Leer el cuerpo como" data-testid="body-format">
          {FORMATS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <span className="mini-label mono">{decoded.contentType.split(";")[0] || decoded.kind}</span>
        <span className="end">
          {textual && view !== "preview" && (
            <button type="button" className="icon-btn" title="Buscar en el cuerpo (Ctrl F)" aria-label="Buscar en el cuerpo" onClick={() => viewer.current?.openSearch()} data-testid="body-search">
              <Icon name="search" size={14} />
            </button>
          )}
          <button type="button" className="icon-btn" title="Ajustar líneas" aria-label="Ajustar líneas" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <Icon name="wrap" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={copied ? "Copiado" : filtered?.ok ? "Copiar el resultado del filtro" : "Copiar cuerpo"}
            aria-label="Copiar cuerpo"
            disabled={!decoded.text}
            onClick={() => {
              void navigator.clipboard.writeText(shown).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        </span>
      </div>
      {filterable && (
        <div className="body-filter">
          <span className="mini-label">{decoded.kind === "json" ? "JSONPath" : "XPath"}</span>
          <input
            className="mono"
            value={tab.bodyFilter}
            onChange={(e) => patch(tab.id, { bodyFilter: e.target.value })}
            placeholder={decoded.kind === "json" ? "$.productos[*].nombre" : "//producto/nombre"}
            spellCheck={false}
            aria-label={decoded.kind === "json" ? "Filtrar con JSONPath" : "Filtrar con XPath"}
            aria-invalid={filtered?.ok === false}
            data-testid="body-filter"
          />
          {filtered && (
            <span className={`filter-state${filtered.ok ? "" : " bad"}`} data-testid="body-filter-state" role="status">
              {filtered.ok ? `${filtered.count} ${filtered.count === 1 ? "resultado" : "resultados"}` : filtered.error}
            </span>
          )}
          {tab.bodyFilter && (
            <button type="button" className="icon-btn" aria-label="Quitar el filtro" title="Quitar el filtro" onClick={() => patch(tab.id, { bodyFilter: "" })}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      )}
      <div className={`pane-body${textual && view !== "preview" ? " viewer-host" : ""}`}>
        {decoded.kind === "empty" && <p className="hint pad">La respuesta no tiene cuerpo.</p>}
        {decoded.kind === "binary" && <p className="hint pad">Contenido binario de {formatBytes(response.sizes.body)}; no se muestra como texto.</p>}
        {decoded.kind === "image" && view === "preview" &&
          (decoded.imageUrl ? <img className="preview-img" src={decoded.imageUrl} alt="Imagen recibida" /> : <p className="hint pad">La imagen supera 10 MB y no se previsualiza.</p>)}
        {decoded.kind === "html" && view === "preview" && <HtmlPreview html={decoded.text} />}
        {textual && view !== "preview" && <CodeViewer ref={viewer} text={shown} language={language} wrap={wrap} label="Cuerpo de la respuesta" testId="response-body" />}
      </div>
    </>
  );
}

/** HTML rendered by main in a sandboxed iframe: no scripts, no network, no way back into the app. */
function HtmlPreview({ html }: { html: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    void window.sendix.app.preview(html).then((u) => {
      if (!live) return;
      setUrl(u);
      setRefused(u === null);
    });
    return () => {
      live = false;
    };
  }, [html]);
  if (refused) return <p className="hint pad">Esta página es demasiado grande para la vista previa. Usa la vista Formateado.</p>;
  return (
    <div className="html-preview">
      <p className="hint preview-note">Vista previa sin scripts ni conexión: no se cargan imágenes ni hojas de estilo externas.</p>
      {url && <iframe src={url} sandbox="" title="Vista previa de la respuesta HTML" data-testid="html-preview" />}
    </div>
  );
}

function HeaderList({ rows, testId }: { rows: Array<{ key: string; value: string }>; testId: string }) {
  return (
    <div className="pane-body">
      <table className="kv readonly" data-testid={testId}>
        <colgroup>
          <col style={{ width: "34%" }} />
          <col />
        </colgroup>
        <tbody>
          {rows.map((h, i) => (
            <tr key={`${h.key}-${i}`}>
              <td className="mono k">{h.key}</td>
              <td className="mono v">{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CookieList({ response }: { response: HttpResponse }) {
  if (response.cookies.length === 0) return <p className="hint pad">La respuesta no estableció cookies.</p>;
  return (
    <div className="pane-body">
      <table className="kv readonly">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Valor</th>
            <th>Dominio</th>
            <th>Ruta</th>
            <th>Caduca</th>
            <th>Atributos</th>
          </tr>
        </thead>
        <tbody>
          {response.cookies.map((c, i) => (
            <tr key={`${c.name}-${i}`}>
              <td className="mono">{c.name}</td>
              <td className="mono">{c.value}</td>
              <td className="mono">{c.domain ?? "—"}</td>
              <td className="mono">{c.path ?? "—"}</td>
              <td className="mono">{c.expires ? new Date(c.expires).toLocaleString("es-MX") : "Sesión"}</td>
              <td>{[c.httpOnly && "HttpOnly", c.secure && "Secure"].filter(Boolean).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ response }: { response: HttpResponse }) {
  const t = response.timings;
  const rows: Array<[string, number, string]> = [
    ["Redirecciones previas", t.redirects, `${response.redirectCount} salto${response.redirectCount === 1 ? "" : "s"} antes de la respuesta final`],
    ["Búsqueda DNS", t.dns, "0 si el nombre ya estaba resuelto o es una IP"],
    ["Conexión TCP", t.tcp, "0 si se reutilizó una conexión abierta"],
    ["Negociación TLS", t.tls, "solo en https"],
    ["Espera del primer byte", t.wait, "tiempo de trabajo del servidor y de la red"],
    ["Descarga", t.download, formatBytes(response.sizes.body)],
  ];
  return (
    <div className="pane-body">
      <table className="kv readonly">
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: 90 }} />
          <col />
        </colgroup>
        <tbody>
          {rows.map(([label, ms, detail]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="mono">{formatMs(ms)}</td>
              <td className="muted">{detail}</td>
            </tr>
          ))}
          <tr>
            <td>
              <b>Total</b>
            </td>
            <td className="mono">
              <b>{formatMs(t.total)}</b>
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="section-label">
        Petición enviada <span>lo que salió por la red en el último salto</span>
      </div>
      <div className="code-block">
        <pre className="code flush" data-testid="sent-request">
          <span className="ln">
            <span className="t-kw">{response.sent.method}</span> {response.sent.url}
          </span>
          {response.sent.headers.map((h, i) => (
            <span className="ln" key={i}>
              <span className="t-key">{h.key}</span>
              <span className="t-punct">:</span> {h.value}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}

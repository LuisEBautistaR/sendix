import { CALL_TYPE_LABEL, GRPC_STATUS_HINT, type GrpcTls } from "@shared/grpc";
import { isDirty, useStore, type GrpcPanel, type GrpcTab } from "../state/store";
import { clockTime, explainError, formatBytes, formatMs } from "../lib/format";
import { Icon } from "../Icon";
import { CodeEditor } from "./CodeEditor";
import { CodeView } from "./CodeView";
import { KvTable } from "./KvTable";
import { UrlInput } from "./UrlInput";
import { METHODS } from "./RequestPane";

const streamsRequests = (tab: GrpcTab) => tab.callType === "client" || tab.callType === "bidi";

export function GrpcLine({ tab }: { tab: GrpcTab }) {
  const { switchProtocol, invokeGrpc, cancelGrpc, save, setGrpcDraft, describeGrpc } = useStore.getState();
  const dirty = isDirty(tab);
  const busy = tab.state !== "idle";
  const selected = `${tab.draft.service}/${tab.draft.method}`;
  const known = tab.services?.some((s) => s.name === tab.draft.service && s.methods.some((m) => m.name === tab.draft.method));
  return (
    <form
      className="reqline"
      onSubmit={(e) => {
        e.preventDefault();
        void (busy ? cancelGrpc(tab.id) : invokeGrpc(tab.id));
      }}
    >
      <div className="urlbox">
        <select className="method-select m-grpc" value="grpc" aria-label="Protocolo" data-testid="method" disabled={busy || !!tab.source} onChange={(e) => switchProtocol(tab.id, e.target.value)}>
          <option value="grpc">gRPC</option>
          {!tab.source && (
            <>
              <option value="websocket">WS</option>
              <option value="socketio">Socket.IO</option>
              <optgroup label="HTTP">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </select>
        <UrlInput tab={tab} />
        <select
          className="grpc-method mono"
          aria-label="Método"
          data-testid="grpc-method"
          value={tab.draft.service ? selected : ""}
          disabled={busy}
          onFocus={() => {
            if (!tab.services && !tab.describing && (tab.draft.definition.source === "files" ? tab.draft.definition.files.length > 0 : tab.draft.target.trim() !== "")) void describeGrpc(tab.id);
          }}
          onChange={(e) => {
            const [service = "", method = ""] = e.target.value.split(/\/(?=[^/]+$)/);
            const info = tab.services?.find((s) => s.name === service)?.methods.find((m) => m.name === method);
            setGrpcDraft(tab.id, (d) => ({ ...d, service, method, message: info && (d.message.trim() === "{}" || !d.message.trim()) ? info.example : d.message }));
          }}
        >
          <option value="" disabled>
            {tab.describing ? "Cargando servicios…" : "Elige un método"}
          </option>
          {tab.draft.service && !known && <option value={selected}>{selected.split(".").pop()}</option>}
          {tab.services?.map((s) => (
            <optgroup key={s.name} label={s.name}>
              {s.methods.map((m) => (
                <option key={m.name} value={`${s.name}/${m.name}`}>
                  {m.name}
                  {m.type !== "unary" ? `  · ${CALL_TYPE_LABEL[m.type].toLowerCase()}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {busy ? (
        <button key="cancel" type="submit" className="btn btn-secondary" data-testid="grpc-cancel">
          Cancelar
        </button>
      ) : (
        <button key="invoke" type="submit" className="btn btn-primary" disabled={!tab.draft.target.trim() || !tab.draft.method} data-testid="grpc-invoke">
          Invocar <kbd>Ctrl ↵</kbd>
        </button>
      )}
      <button
        type="button"
        className={`btn btn-secondary btn-icon${dirty ? " dirty" : ""}`}
        title={tab.source ? (dirty ? "Guardar cambios (Ctrl S)" : "Guardada") : "Guardar en una colección (Ctrl S)"}
        aria-label="Guardar"
        onClick={() => void save(tab.id)}
        data-testid="save"
      >
        <Icon name="save" size={16} />
      </button>
    </form>
  );
}

const PANELS: Array<{ id: GrpcPanel; label: string }> = [
  { id: "message", label: "Mensaje" },
  { id: "metadata", label: "Metadatos" },
  { id: "definition", label: "Definición" },
  { id: "settings", label: "Ajustes" },
];

export function GrpcEditor({ tab }: { tab: GrpcTab }) {
  const { patchGrpc } = useStore.getState();
  const mdCount = tab.draft.metadata.filter((h) => h.enabled && h.key).length;
  return (
    <div className="pane">
      <div className="subtabs" role="tablist" aria-label="Partes de la llamada">
        {PANELS.map((p) => (
          <button key={p.id} type="button" role="tab" className="subtab" aria-selected={tab.panel === p.id} data-testid={`grpc-tab-${p.id}`} onClick={() => patchGrpc(tab.id, { panel: p.id })}>
            {p.label} {p.id === "metadata" && mdCount ? <span className="n">{mdCount}</span> : null}
            {p.id === "definition" ? <span className="n">{tab.draft.definition.source === "reflection" ? "reflexión" : `${tab.draft.definition.files.length} .proto`}</span> : null}
          </button>
        ))}
      </div>
      <div className="pane-body" role="tabpanel">
        {tab.panel === "message" && <MessagePanel tab={tab} />}
        {tab.panel === "metadata" && (
          <>
            <KvTable name="metadata" keyLabel="Clave" rows={tab.draft.metadata} onChange={(metadata) => useStore.getState().setGrpcDraft(tab.id, (d) => ({ ...d, metadata }))} />
            <p className="hint pad">Las claves se envían en minúsculas. Las que terminan en -bin llevan valores binarios escritos en base64.</p>
          </>
        )}
        {tab.panel === "definition" && <DefinitionPanel tab={tab} />}
        {tab.panel === "settings" && <SettingsPanel tab={tab} />}
      </div>
    </div>
  );
}

function MessagePanel({ tab }: { tab: GrpcTab }) {
  const { setGrpcDraft, sendGrpc, endGrpc, describeGrpc } = useStore.getState();
  const info = tab.services?.find((s) => s.name === tab.draft.service)?.methods.find((m) => m.name === tab.draft.method);
  const streaming = tab.state === "running" && streamsRequests(tab);
  return (
    <>
      <div className="toolbar">
        <span className="mini-label">
          {info ? (
            <>
              <span className="mono">{info.requestType}</span> → <span className="mono">{info.responseType}</span> · {CALL_TYPE_LABEL[info.type]}
            </>
          ) : tab.draft.method ? (
            "Carga los servicios para ver los tipos del método"
          ) : (
            "Elige un método arriba"
          )}
        </span>
        <span className="end">
          {info ? (
            <button type="button" className="link-btn" onClick={() => setGrpcDraft(tab.id, (d) => ({ ...d, message: info.example }))} data-testid="grpc-example">
              Generar ejemplo
            </button>
          ) : (
            <button type="button" className="link-btn" disabled={tab.describing} onClick={() => void describeGrpc(tab.id)}>
              {tab.describing ? "Cargando…" : "Cargar servicios"}
            </button>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              try {
                setGrpcDraft(tab.id, (d) => ({ ...d, message: JSON.stringify(JSON.parse(d.message), null, 2) }));
              } catch {
                /* leave invalid JSON as typed */
              }
            }}
          >
            Formatear
          </button>
        </span>
      </div>
      <div className="composer tall">
        <CodeEditor value={tab.draft.message} onChange={(message) => setGrpcDraft(tab.id, (d) => ({ ...d, message }))} language="json" label="Mensaje gRPC" testId="grpc-message" />
      </div>
      <div className="composer-foot">
        <span className="hint">
          {info?.type === "client" || info?.type === "bidi"
            ? "Invoca para abrir el stream y envía cada mensaje con Enviar."
            : "JSON con los nombres de campo del .proto; los enteros de 64 bits van como texto."}
        </span>
        {streaming && (
          <span className="end">
            <button type="button" className="btn btn-secondary btn-sm" disabled={tab.halfClosed} onClick={() => void endGrpc(tab.id)} data-testid="grpc-end">
              Terminar envío
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={tab.halfClosed} onClick={() => void sendGrpc(tab.id)} data-testid="grpc-send">
              Enviar <kbd>Ctrl ↵</kbd>
            </button>
          </span>
        )}
      </div>
    </>
  );
}

function DefinitionPanel({ tab }: { tab: GrpcTab }) {
  const { setGrpcDraft, pickGrpcFiles, describeGrpc } = useStore.getState();
  const def = tab.draft.definition;
  const setDef = (patch: Partial<typeof def>) => setGrpcDraft(tab.id, (d) => ({ ...d, definition: { ...d.definition, ...patch } }));
  return (
    <div className="form wide">
      <span className="seg" role="radiogroup" aria-label="Origen de la definición">
        <button type="button" role="radio" aria-checked={def.source === "reflection"} aria-pressed={def.source === "reflection"} onClick={() => setDef({ source: "reflection" })} data-testid="grpc-source-reflection">
          Reflexión del servidor
        </button>
        <button type="button" role="radio" aria-checked={def.source === "files"} aria-pressed={def.source === "files"} onClick={() => setDef({ source: "files" })} data-testid="grpc-source-files">
          Archivos .proto
        </button>
      </span>
      {def.source === "reflection" ? (
        <p className="hint">Sendix pregunta al servidor qué servicios ofrece (gRPC server reflection v1 o v1alpha). Usa la dirección, el TLS y los metadatos de esta llamada.</p>
      ) : (
        <>
          <PathList label="Archivos" empty="Ningún archivo .proto todavía" paths={def.files} onRemove={(p) => setDef({ files: def.files.filter((f) => f !== p) })} onAdd={() => void pickGrpcFiles(tab.id, "proto")} addLabel="Añadir .proto…" testId="grpc-files" />
          <PathList
            label="Rutas de importación"
            empty="Solo la carpeta de cada archivo"
            paths={def.importPaths}
            onRemove={(p) => setDef({ importPaths: def.importPaths.filter((f) => f !== p) })}
            onAdd={() => void pickGrpcFiles(tab.id, "importPath")}
            addLabel="Añadir carpeta…"
          />
          <p className="hint">Los imports de google/protobuf (Timestamp, Any, Struct…) vienen incluidos.</p>
        </>
      )}
      <div className="inline-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={tab.describing} onClick={() => void describeGrpc(tab.id)} data-testid="grpc-describe">
          {tab.describing ? "Cargando…" : "Cargar servicios"}
        </button>
        {tab.services && !tab.describeError && (
          <span className="hint" data-testid="grpc-services">
            {tab.services.length} {tab.services.length === 1 ? "servicio" : "servicios"}, {tab.services.reduce((n, s) => n + s.methods.length, 0)} métodos
          </span>
        )}
      </div>
      {tab.describeError && (
        <p className="notice warn" data-testid="grpc-describe-error">
          <span>
            {GRPC_STATUS_HINT[tab.describeError.code] ? `${GRPC_STATUS_HINT[tab.describeError.code]}. ` : ""}
            <span className="mono">{tab.describeError.message}</span>
          </span>
        </p>
      )}
      {tab.services && (
        <ul className="services">
          {tab.services.map((s) => (
            <li key={s.name}>
              <b className="mono">{s.name}</b>
              <ul>
                {s.methods.map((m) => (
                  <li key={m.name}>
                    <span className="mono">{m.name}</span>
                    <span className="muted">
                      {m.requestType.split(".").pop()} → {m.responseType.split(".").pop()} · {CALL_TYPE_LABEL[m.type]}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PathList({ label, empty, paths, onRemove, onAdd, addLabel, testId }: { label: string; empty: string; paths: string[]; onRemove(p: string): void; onAdd(): void; addLabel: string; testId?: string }) {
  return (
    <div className="path-list" data-testid={testId}>
      <span className="path-label">{label}</span>
      <div>
        {paths.length === 0 && <span className="hint">{empty}</span>}
        {paths.map((p) => (
          <span key={p} className="path-chip mono" title={p}>
            {p.split(/[\\/]/).pop()}
            <button type="button" className="icon-btn" aria-label={`Quitar ${p}`} onClick={() => onRemove(p)}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <button type="button" className="link-btn" onClick={onAdd}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

const TLS_LABEL: Record<GrpcTls, string> = { none: "Sin TLS (texto plano)", tls: "TLS verificado", insecure: "TLS sin verificar el certificado" };

function SettingsPanel({ tab }: { tab: GrpcTab }) {
  const { setGrpcDraft, pickGrpcFiles } = useStore.getState();
  const s = tab.draft.settings;
  const set = (patch: Partial<typeof s>) => setGrpcDraft(tab.id, (d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const fileField = (label: string, key: "caFile" | "certFile" | "keyFile", kind: "ca" | "cert" | "key") => (
    <label className="field">
      <span>{label}</span>
      <span className="inline">
        <span className="mono path-value" title={s[key]}>
          {s[key] ? s[key].split(/[\\/]/).pop() : "ninguno"}
        </span>
        <button type="button" className="link-btn" onClick={() => void pickGrpcFiles(tab.id, kind)}>
          Elegir…
        </button>
        {s[key] && (
          <button type="button" className="link-btn" onClick={() => set({ [key]: "" })}>
            Quitar
          </button>
        )}
      </span>
    </label>
  );
  return (
    <div className="form">
      <label className="field">
        <span>Conexión</span>
        <select value={s.tls} onChange={(e) => set({ tls: e.target.value as GrpcTls })} data-testid="grpc-tls">
          {(Object.keys(TLS_LABEL) as GrpcTls[]).map((t) => (
            <option key={t} value={t}>
              {TLS_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {s.tls !== "none" && (
        <>
          {fileField("CA propia", "caFile", "ca")}
          {fileField("Certificado cliente", "certFile", "cert")}
          {fileField("Clave cliente", "keyFile", "key")}
          <p className="hint">El certificado y la clave del cliente son para TLS mutuo (mTLS). Sendix solo lee los archivos que eliges aquí.</p>
        </>
      )}
      {s.tls === "insecure" && <p className="notice warn">No se verifica el certificado del servidor. Úsalo solo con servidores de prueba.</p>}
      <label className="field">
        <span>Tiempo máximo</span>
        <span className="inline">
          <input className="mono short" type="number" min={0} max={3600} value={s.deadlineMs / 1000} onChange={(e) => set({ deadlineMs: Math.min(3600, Math.max(0, Math.round(Number(e.target.value) || 0))) * 1000 })} /> segundos
          (0 = sin límite)
        </span>
      </label>
    </div>
  );
}

// ---------- response ----------

function prettyJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function GrpcResponse({ tab }: { tab: GrpcTab }) {
  const { patchGrpc } = useStore.getState();
  const st = tab.status;
  const received = tab.log.filter((e) => e.dir === "in");
  const single = tab.callType === "unary" || tab.callType === "client";
  if (tab.state === "idle" && !st && !tab.startError) {
    return (
      <div className="pane response-state" data-testid="grpc-empty">
        <p className="state-title">Aún no hay respuesta</p>
        <p className="muted">Escribe la dirección del servidor, elige el método (con reflexión o tus archivos .proto) y pulsa Invocar. Verás el estado gRPC, los mensajes y los metadatos.</p>
      </div>
    );
  }
  if (tab.startError) {
    return (
      <div className="pane response-state" data-testid="grpc-error">
        <p className="state-title err">No se pudo iniciar la llamada</p>
        <p>{GRPC_STATUS_HINT[tab.startError.code] ?? explainError(tab.startError.code)}</p>
        <dl className="facts compact">
          <dt>Código</dt>
          <dd className="mono">{tab.startError.code}</dd>
          <dt>Detalle</dt>
          <dd className="mono">{tab.startError.message}</dd>
        </dl>
      </div>
    );
  }
  const counts = { headers: tab.headers.length + (st?.trailers.length ?? 0) };
  return (
    <div className="pane" data-testid="grpc-response">
      <div className="resp-head">
        <div className="status-line">
          {st ? (
            <span className={`status ${st.code === 0 ? "ok" : "err"}`} data-testid="grpc-status">
              <span className="code-n">{st.code}</span> {st.name}
            </span>
          ) : (
            <span className="status" data-testid="grpc-status">
              {tab.state === "starting" ? "Iniciando…" : streamsRequests(tab) ? (tab.halfClosed ? "Esperando la respuesta…" : "Stream abierto") : "En curso…"}
            </span>
          )}
          {st && (
            <span className="metric">
              Tiempo <b>{formatMs(st.elapsedMs)}</b>
            </span>
          )}
          <span className="metric">
            Mensajes <b>{received.length}</b>
          </span>
          {tab.callType && <span className="metric">{CALL_TYPE_LABEL[tab.callType]}</span>}
        </div>
        {st && st.code !== 0 && (
          <p className="rt-failure" data-testid="grpc-status-detail">
            {GRPC_STATUS_HINT[st.name] ?? ""}
            {st.details ? <>: <span className="mono">{st.details}</span></> : null}
          </p>
        )}
      </div>
      <div className="subtabs" role="tablist" aria-label="Partes de la respuesta">
        <button type="button" role="tab" className="subtab" aria-selected={tab.responsePanel === "response"} onClick={() => patchGrpc(tab.id, { responsePanel: "response" })}>
          {single ? "Respuesta" : "Mensajes"} {received.length && !single ? <span className="n">{received.length}</span> : null}
        </button>
        <button type="button" role="tab" className="subtab" aria-selected={tab.responsePanel === "metadata"} onClick={() => patchGrpc(tab.id, { responsePanel: "metadata" })} data-testid="grpc-res-metadata">
          Metadatos {counts.headers ? <span className="n">{counts.headers}</span> : null}
        </button>
      </div>
      {tab.responsePanel === "metadata" ? (
        <div className="pane-body">
          <div className="section-label">Cabeceras de respuesta</div>
          <MetaTable rows={tab.headers} empty="El servidor no envió cabeceras." />
          <div className="section-label">Trailers</div>
          <MetaTable rows={st?.trailers ?? []} empty={st ? "Sin trailers." : "Llegan al terminar la llamada."} />
        </div>
      ) : single ? (
        <div className="pane-body">
          {received[0] ? <CodeView text={prettyJson(received[0].text)} json wrap testId="grpc-body" /> : <p className="hint pad">{st ? "La llamada terminó sin mensaje de respuesta." : "Esperando la respuesta…"}</p>}
        </div>
      ) : (
        <div className="pane-body">
          <ul className="msgs" data-testid="grpc-messages">
            {tab.log.map((e) => {
              const open = tab.selected === e.seq;
              return (
                <li key={e.seq}>
                  <button type="button" className="msg" aria-expanded={open} onClick={() => patchGrpc(tab.id, { selected: open ? null : e.seq })} data-testid={`grpc-msg-${e.dir}`}>
                    <span className={e.dir === "in" ? "dir-in" : "dir-out"} aria-label={e.dir === "in" ? "Recibido" : "Enviado"}>
                      {e.dir === "in" ? "↓" : "↑"}
                    </span>
                    <span className="time">{clockTime(e.at)}</span>
                    <span className="pv">{e.text.replace(/\s+/g, " ")}</span>
                    <span className="sz">{formatBytes(e.size)}</span>
                  </button>
                  {open && (
                    <div className="msg-detail">
                      <CodeView text={prettyJson(e.text)} json wrap />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetaTable({ rows, empty }: { rows: Array<{ key: string; value: string }>; empty: string }) {
  if (!rows.length) return <p className="hint pad">{empty}</p>;
  return (
    <table className="kv readonly">
      <colgroup>
        <col style={{ width: "34%" }} />
        <col />
      </colgroup>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.key}-${i}`}>
            <td className="mono k">{r.key}</td>
            <td className="mono v">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

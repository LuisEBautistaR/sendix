import { useEffect, useMemo, useState } from "react";
import { closeCodeLabel, type SavedMessage } from "@shared/realtime";
import { isDirty, useStore, type LogEntry, type RealtimePanel, type RealtimeTab } from "../state/store";
import { clockTime, explainError, formatBytes, formatDuration } from "../lib/format";
import { Icon } from "../Icon";
import { CodeEditor } from "./CodeEditor";
import { CodeView } from "./CodeView";
import { KvTable } from "./KvTable";
import { UrlInput } from "./UrlInput";
import { methodClass, METHODS } from "./RequestPane";

export function RealtimeLine({ tab }: { tab: RealtimeTab }) {
  const { switchProtocol, connect, disconnect, save } = useStore.getState();
  const dirty = isDirty(tab);
  const busy = tab.state !== "idle";
  return (
    <form
      className="reqline"
      onSubmit={(e) => {
        e.preventDefault();
        void (busy ? disconnect(tab.id) : connect(tab.id));
      }}
    >
      <div className="urlbox">
        <select
          className={`method-select ${methodClass(tab.draft.protocol === "websocket" ? "WS" : "SIO")}`}
          value={tab.draft.protocol}
          aria-label="Protocolo"
          data-testid="method"
          disabled={busy}
          onChange={(e) => switchProtocol(tab.id, e.target.value)}
        >
          <option value="websocket">WS</option>
          <option value="socketio">Socket.IO</option>
          {!tab.source && <option value="grpc">gRPC</option>}
          {!tab.source && (
            <optgroup label="HTTP">
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <UrlInput tab={tab} />
      </div>
      {tab.state === "open" || tab.state === "closing" ? (
        <button key="close" type="submit" className="btn btn-secondary" disabled={tab.state === "closing"} data-testid="disconnect">
          {tab.state === "closing" ? "Desconectando…" : "Desconectar"}
        </button>
      ) : tab.state === "connecting" ? (
        <button key="cancel" type="submit" className="btn btn-secondary" data-testid="disconnect">
          Cancelar
        </button>
      ) : (
        <button key="connect" type="submit" className="btn btn-primary" disabled={tab.draft.url.trim() === ""} data-testid="connect">
          Conectar <kbd>Ctrl ↵</kbd>
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

const PANELS: Array<{ id: RealtimePanel; label: string }> = [
  { id: "message", label: "Mensaje" },
  { id: "headers", label: "Cabeceras" },
  { id: "settings", label: "Ajustes" },
];

export function RealtimeEditor({ tab }: { tab: RealtimeTab }) {
  const { patchRealtime } = useStore.getState();
  const headerCount = tab.draft.headers.filter((h) => h.enabled && h.key).length;
  return (
    <div className="pane">
      <div className="subtabs" role="tablist" aria-label="Partes de la conexión">
        {PANELS.map((p) => (
          <button key={p.id} type="button" role="tab" className="subtab" aria-selected={tab.panel === p.id} data-testid={`rt-tab-${p.id}`} onClick={() => patchRealtime(tab.id, { panel: p.id })}>
            {p.label} {p.id === "headers" && headerCount ? <span className="n">{headerCount}</span> : null}
            {p.id === "message" && tab.draft.messages.length ? <span className="n">{tab.draft.messages.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="pane-body" role="tabpanel">
        {tab.panel === "message" && <MessagePanel tab={tab} />}
        {tab.panel === "headers" && <HeadersPanel tab={tab} />}
        {tab.panel === "settings" && <SettingsPanel tab={tab} />}
      </div>
    </div>
  );
}

function MessagePanel({ tab }: { tab: RealtimeTab }) {
  const { patchRealtime, setRealtimeDraft, sendMessage } = useStore.getState();
  const c = tab.composer;
  const sio = tab.draft.protocol === "socketio";
  const setComposer = (patch: Partial<typeof c>) => patchRealtime(tab.id, { composer: { ...c, ...patch } });
  const saveMessage = () => {
    const name = (sio && c.event.trim()) || c.body.trim().replace(/\s+/g, " ").slice(0, 40) || "Mensaje";
    setRealtimeDraft(tab.id, (d) => ({ ...d, messages: [...d.messages, { name, body: c.body, language: c.language, event: c.event }] }));
  };
  const updateSaved = (index: number, patch: Partial<SavedMessage> | null) =>
    setRealtimeDraft(tab.id, (d) => ({ ...d, messages: patch === null ? d.messages.filter((_, i) => i !== index) : d.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));

  return (
    <>
      <div className="toolbar">
        <span className="seg" role="radiogroup" aria-label="Formato del mensaje">
          {(["json", "text"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={c.language === l} aria-pressed={c.language === l} onClick={() => setComposer({ language: l })}>
              {l === "json" ? "JSON" : "Texto"}
            </button>
          ))}
        </span>
        {sio && (
          <>
            <input className="mini-input mono" value={c.event} placeholder="evento" aria-label="Evento" onChange={(e) => setComposer({ event: e.target.value })} data-testid="sio-event" />
            <label className="mini-check" title="Pide al servidor que responda a este emit">
              <input type="checkbox" className="check" checked={c.ack} onChange={(e) => setComposer({ ack: e.target.checked })} data-testid="sio-ack" /> Esperar ack
            </label>
          </>
        )}
        {c.language === "json" && (
          <span className="end">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                try {
                  setComposer({ body: JSON.stringify(JSON.parse(c.body), null, 2) });
                } catch {
                  /* leave invalid JSON as typed */
                }
              }}
            >
              Formatear
            </button>
          </span>
        )}
      </div>
      <div className="composer">
        <CodeEditor value={c.body} onChange={(body) => setComposer({ body })} language={c.language} label="Mensaje" testId="rt-message" placeholder={c.language === "json" ? '{ "tipo": "suscribir" }' : "Texto del mensaje"} />
      </div>
      <div className="composer-foot">
        <span className="hint">Las {"{{variables}}"} se sustituyen al enviar.</span>
        <span className="end">
          <button type="button" className="btn btn-secondary btn-sm" onClick={saveMessage} disabled={!c.body.trim() && !(sio && c.event.trim())} data-testid="save-message">
            Guardar mensaje
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={tab.state !== "open"} onClick={() => void sendMessage(tab.id)} data-testid="send-message">
            Enviar <kbd>Ctrl ↵</kbd>
          </button>
        </span>
      </div>

      <div className="section-label">
        Mensajes guardados <span>{tab.draft.messages.length || "ninguno todavía"}</span>
      </div>
      {tab.draft.messages.length > 0 && (
        <ul className="saved" data-testid="saved-messages">
          {tab.draft.messages.map((m, i) => (
            <li key={i}>
              <input className="name" value={m.name} aria-label="Nombre del mensaje" onChange={(e) => updateSaved(i, { name: e.target.value })} />
              <span className="pv mono">
                {sio && m.event ? <b>{m.event} </b> : null}
                {m.body.replace(/\s+/g, " ")}
              </span>
              <button type="button" className="link-btn" onClick={() => patchRealtime(tab.id, { composer: { ...c, body: m.body, language: m.language, event: m.event } })}>
                Cargar
              </button>
              <button type="button" className="icon-btn" aria-label={`Quitar ${m.name}`} onClick={() => updateSaved(i, null)}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab.handshake && (
        <>
          <div className="section-label">
            Conexión <span>negociada</span>
          </div>
          <dl className="facts" data-testid="handshake">
            {tab.handshake.status !== null && (
              <>
                <dt>Subprotocolo</dt>
                <dd className="mono">{tab.handshake.protocol || "ninguno"}</dd>
                <dt>Extensiones</dt>
                <dd className="mono">{tab.handshake.extensions || "ninguna"}</dd>
              </>
            )}
            {tab.handshake.socketId && (
              <>
                <dt>Socket</dt>
                <dd className="mono">{tab.handshake.socketId}</dd>
                <dt>Transporte</dt>
                <dd className="mono">{tab.handshake.transport ?? "—"}</dd>
              </>
            )}
            <dt>Reconexión</dt>
            <dd>{tab.draft.settings.reconnect ? `Activada · máx. ${tab.draft.settings.maxRetries} intentos` : "Desactivada"}</dd>
          </dl>
        </>
      )}

      {tab.connections.length > 0 && (
        <>
          <div className="section-label">
            Últimas conexiones <span>de esta pestaña</span>
          </div>
          <table className="kv readonly" data-testid="connections">
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Cierre</th>
                <th>Duración</th>
                <th>Mensajes</th>
              </tr>
            </thead>
            <tbody>
              {tab.connections.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{clockTime(r.start)}</td>
                  <td>
                    <span className={`st ${r.code === 1000 || r.code === null ? "ok" : "err"}`}>
                      {r.code !== null ? `${r.code} ${closeCodeLabel(r.code)}` : r.reason}
                    </span>
                  </td>
                  <td className="mono">{formatDuration(r.end - r.start)}</td>
                  <td className="mono">{r.messages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function HeadersPanel({ tab }: { tab: RealtimeTab }) {
  const { setRealtimeDraft } = useStore.getState();
  const [subprotocols, setSubprotocols] = useState(tab.draft.subprotocols.join(", "));
  return (
    <>
      <KvTable name="headers" keyLabel="Cabecera" rows={tab.draft.headers} onChange={(headers) => setRealtimeDraft(tab.id, (d) => ({ ...d, headers }))} />
      {tab.draft.protocol === "websocket" ? (
        <div className="form">
          <label className="field">
            <span>Subprotocolos</span>
            <input
              className="mono"
              value={subprotocols}
              placeholder="tienda.v2, tienda.v1"
              data-testid="subprotocols"
              onChange={(e) => {
                setSubprotocols(e.target.value);
                const list = e.target.value.split(",").map((p) => p.trim()).filter(Boolean);
                setRealtimeDraft(tab.id, (d) => ({ ...d, subprotocols: list }));
              }}
            />
          </label>
          <p className="hint">Se ofrecen en este orden en la cabecera Sec-WebSocket-Protocol; el servidor elige uno.</p>
        </div>
      ) : (
        <p className="hint pad">Las cabeceras viajan en el saludo inicial (también en el sondeo HTTP si el servidor empieza por ahí).</p>
      )}
    </>
  );
}

function SettingsPanel({ tab }: { tab: RealtimeTab }) {
  const { setRealtimeDraft } = useStore.getState();
  const s = tab.draft.settings;
  const set = (patch: Partial<typeof s>) => setRealtimeDraft(tab.id, (d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const sio = tab.draft.protocol === "socketio";
  const authInvalid = useMemo(() => {
    if (!s.auth.trim()) return false;
    try {
      const v: unknown = JSON.parse(s.auth.replace(/\{\{[^}]+\}\}/g, "0"));
      return !v || typeof v !== "object" || Array.isArray(v);
    } catch {
      return true;
    }
  }, [s.auth]);
  return (
    <div className="form">
      <label className="switch">
        <input type="checkbox" className="check" checked={s.reconnect} onChange={(e) => set({ reconnect: e.target.checked })} data-testid="rt-reconnect" />
        <span>
          Reconectar si se corta
          <small>Solo tras una conexión que llegó a abrirse; nunca si la cierras tú.</small>
        </span>
      </label>
      {s.reconnect && (
        <label className="field">
          <span>Intentos máximos</span>
          <input className="mono short" type="number" min={1} max={20} value={s.maxRetries} onChange={(e) => set({ maxRetries: Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
        </label>
      )}
      <label className="field">
        <span>Tiempo para conectar</span>
        <span className="inline">
          <input className="mono short" type="number" min={1} max={120} value={s.timeoutMs / 1000} onChange={(e) => set({ timeoutMs: Math.min(120, Math.max(1, Math.round(Number(e.target.value) || 1))) * 1000 })} /> segundos
        </span>
      </label>
      <label className="switch">
        <input type="checkbox" className="check" checked={s.verifyTls} onChange={(e) => set({ verifyTls: e.target.checked })} />
        <span>
          Verificar el certificado TLS
          <small>Desactívalo solo para servidores de prueba con certificados propios.</small>
        </span>
      </label>
      {sio && (
        <>
          <label className="field">
            <span>Ruta del servidor</span>
            <input className="mono" value={s.path} placeholder="/socket.io" onChange={(e) => set({ path: e.target.value })} />
          </label>
          <label className="field top">
            <span>auth</span>
            <textarea className="mono small-editor" value={s.auth} spellCheck={false} placeholder={'{ "token": "{{token}}" }'} onChange={(e) => set({ auth: e.target.value })} data-testid="sio-auth" />
          </label>
          {authInvalid && <p className="notice warn">El campo auth debe ser un objeto JSON.</p>}
          <p className="hint">Compatible con servidores Socket.IO v3 y v4. Los servidores v2 necesitan un cliente antiguo y no se admiten.</p>
        </>
      )}
    </div>
  );
}

// ---------- log ----------

function LiveFor({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{formatDuration(now - since)}</>;
}

const preview = (e: LogEntry) => {
  const m = e.message;
  if (!m) return e.text ?? "";
  if (m.text !== null) return m.text.replace(/\s+/g, " ");
  return `Binario · ${m.binary ? atob(m.binary).slice(0, 16).split("").map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join(" ") : ""}${m.size > 16 ? " …" : ""}`;
};

function detailText(e: LogEntry): { text: string; json: boolean } {
  const m = e.message!;
  if (m.text === null) {
    const bytes = m.binary ? atob(m.binary) : "";
    const hex = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const row = bytes.slice(i, i + 16);
      hex.push(`${i.toString(16).padStart(6, "0")}  ${row.split("").map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join(" ")}`);
    }
    return { text: hex.join("\n"), json: false };
  }
  try {
    return { text: JSON.stringify(JSON.parse(m.text), null, 2), json: true };
  } catch {
    return { text: m.text, json: false };
  }
}

export function RealtimeLog({ tab }: { tab: RealtimeTab }) {
  const { patchRealtime } = useStore.getState();
  const sio = tab.draft.protocol === "socketio";
  const search = tab.search.trim().toLowerCase();
  const rows = tab.log.filter((e) => {
    if (tab.filter !== "all" && e.message?.dir !== tab.filter) return false;
    if (search && !`${e.message?.event ?? ""} ${preview(e)}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const counts = { in: tab.log.filter((e) => e.message?.dir === "in").length, out: tab.log.filter((e) => e.message?.dir === "out").length };
  const h = tab.handshake;

  return (
    <div className="pane" data-testid="rt-log">
      <div className="resp-head">
        <div className="status-line">
          {tab.state === "open" || tab.state === "closing" ? (
            <span className="status ok" data-testid="rt-state">
              {h?.status ? (
                <>
                  <span className="code-n">101</span> Switching Protocols
                </>
              ) : (
                <>Conectado</>
              )}
            </span>
          ) : tab.state === "connecting" ? (
            <span className="status" data-testid="rt-state">
              Conectando…
            </span>
          ) : (
            <span className={`status${tab.failure ? " err" : ""}`} data-testid="rt-state">
              {tab.failure ? (tab.failure.status ? <><span className="code-n">{tab.failure.status}</span> Rechazada</> : "Sin conexión") : "Desconectado"}
            </span>
          )}
          {tab.openedAt && tab.state !== "idle" && (
            <span className="metric">
              Abierta <b><LiveFor since={tab.openedAt} /></b>
            </span>
          )}
          <span className="metric">
            Mensajes <b>{counts.in + counts.out}</b>
          </span>
          {sio && h?.transport && <span className="metric mono">{h.transport}</span>}
          <span className="end">
            <button type="button" className="link-btn" title="Vaciar el registro de mensajes" disabled={!tab.log.length} onClick={() => patchRealtime(tab.id, { log: [], selected: null })}>
              Limpiar
            </button>
          </span>
        </div>
        {tab.failure && (
          <p className="rt-failure" data-testid="rt-failure">
            {explainError(tab.failure.code)} <span className="mono">{tab.failure.message}</span>
          </p>
        )}
      </div>
      <div className="toolbar">
        <span className="seg" role="radiogroup" aria-label="Filtrar mensajes">
          {(
            [
              ["all", "Todos", null],
              ["out", "Enviados", counts.out],
              ["in", "Recibidos", counts.in],
            ] as const
          ).map(([id, label, n]) => (
            <button key={id} type="button" role="radio" aria-checked={tab.filter === id} aria-pressed={tab.filter === id} onClick={() => patchRealtime(tab.id, { filter: id })}>
              {label}
              {n ? <span className="seg-n">{n}</span> : null}
            </button>
          ))}
        </span>
        <span className="end">
          <span className="search-box">
            <Icon name="search" size={13} />
            <input value={tab.search} placeholder="Buscar" aria-label="Buscar mensajes" onChange={(e) => patchRealtime(tab.id, { search: e.target.value })} />
          </span>
        </span>
      </div>
      <div className="pane-body">
        {tab.log.length === 0 ? (
          <div className="response-state">
            <p className="state-title">{tab.state === "idle" ? "Sin conexión" : "Esperando mensajes…"}</p>
            <p className="muted">
              {tab.state === "idle"
                ? `Escribe la URL ${sio ? "del servidor Socket.IO" : "del WebSocket"} y pulsa Conectar. Aquí verás lo que envías y lo que llega, con hora y tamaño.`
                : "Escribe un mensaje a la izquierda y pulsa Enviar."}
            </p>
          </div>
        ) : (
          <ul className="msgs" data-testid="rt-messages">
            {rows.map((e) => {
              const open = tab.selected === e.seq;
              const m = e.message;
              return (
                <li key={e.seq}>
                  <button
                    type="button"
                    className={`msg${m ? "" : ` sys ${e.kind}`}`}
                    aria-expanded={m ? open : undefined}
                    disabled={!m}
                    onClick={() => patchRealtime(tab.id, { selected: open ? null : e.seq })}
                    data-testid={m ? `msg-${m.dir}` : "msg-sys"}
                  >
                    <span className={m ? (m.dir === "in" ? "dir-in" : "dir-out") : "dir-sys"} aria-label={m ? (m.dir === "in" ? "Recibido" : "Enviado") : undefined}>
                      {m ? (m.dir === "in" ? "↓" : "↑") : "•"}
                    </span>
                    <span className="time">{clockTime(e.at)}</span>
                    <span className="pv">
                      {m?.event && <b className="ev">{m.event}</b>}
                      {m?.ack && <span className="ack">ack</span>}
                      {preview(e)}
                    </span>
                    <span className="sz">{m ? formatBytes(m.size) : ""}</span>
                  </button>
                  {open && m && (
                    <div className="msg-detail">
                      <CodeView {...detailText(e)} wrap />
                      {m.truncated && <p className="code-note">Mensaje de {formatBytes(m.size)}; se muestra solo el principio.</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

import { useMemo, useRef } from "react";
import { EMPTY_SCRIPTS, RAW_LANGUAGES, type AuthType, type BodyMode, type RawLanguage, type RequestAuth, type RequestBody } from "@shared/http";
import { isDirty, useStore, type RequestPanel, type RequestTab, type ScriptPhase } from "../state/store";
import { CodeEditor, insertIntoEditor } from "./CodeEditor";
import { SNIPPETS, pmCompletions } from "../lib/pm-completions";
import { Icon } from "../Icon";
import { KvTable } from "./KvTable";
import { RequestInsights } from "./RequestInsights";
import { UrlInput } from "./UrlInput";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export const methodClass = (method: string) => `m-${method.toLowerCase()}`;

const LANGUAGE_LABEL: Record<RawLanguage, string> = { json: "JSON", text: "Texto", xml: "XML", html: "HTML", javascript: "JavaScript" };

export function RequestLine({ tab }: { tab: RequestTab }) {
  const { setDraft, send, cancel, save, switchProtocol } = useStore.getState();
  const sending = tab.status === "sending";
  const dirty = isDirty(tab);
  return (
    <form
      className="reqline"
      onSubmit={(e) => {
        e.preventDefault();
        void send(tab.id);
      }}
    >
      <div className="urlbox">
        <select
          className={`method-select ${methodClass(tab.draft.method)}`}
          value={tab.draft.method}
          aria-label="Método"
          data-testid="method"
          onChange={(e) => {
            const value = e.target.value;
            if (value === "websocket" || value === "socketio" || value === "grpc") switchProtocol(tab.id, value);
            else setDraft(tab.id, (d) => ({ ...d, method: value }));
          }}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {!tab.source && (
            <optgroup label="Tiempo real">
              <option value="websocket">WebSocket</option>
              <option value="socketio">Socket.IO</option>
              <option value="grpc">gRPC</option>
            </optgroup>
          )}
        </select>
        <UrlInput tab={tab} />
      </div>
      {sending ? (
        <button key="cancel" type="button" className="btn btn-secondary" onClick={() => void cancel(tab.id)} data-testid="cancel">
          Cancelar
        </button>
      ) : (
        <button key="send" type="submit" className="btn btn-primary" disabled={tab.draft.url.trim() === ""} data-testid="send">
          Enviar <kbd>Ctrl ↵</kbd>
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

const PANELS: Array<{ id: RequestPanel; label: string }> = [
  { id: "params", label: "Parámetros" },
  { id: "auth", label: "Autorización" },
  { id: "headers", label: "Cabeceras" },
  { id: "body", label: "Cuerpo" },
  { id: "scripts", label: "Scripts" },
  { id: "settings", label: "Ajustes" },
];

function panelCount(tab: RequestTab, id: RequestPanel): string | null {
  if (id === "params") return tab.params.filter((p) => p.enabled).length ? String(tab.params.filter((p) => p.enabled).length) : null;
  if (id === "headers") return tab.draft.headers.filter((h) => h.enabled && h.key).length ? String(tab.draft.headers.filter((h) => h.enabled && h.key).length) : null;
  const body = tab.draft.body;
  if (id === "body" && body.mode !== "none") return body.mode === "raw" ? LANGUAGE_LABEL[body.language] : body.mode === "urlencoded" ? "form" : body.mode === "formdata" ? "multipart" : body.label;
 if (id === "scripts") {
    const s = tab.draft.scripts;
    const n = s ? [s.prerequest, s.test].filter((x) => x.trim()).length : 0;
    return n ? String(n) : null;
  }
  const auth = tab.draft.auth;
  if (id === "auth" && auth.type !== "none") return auth.type === "preserved" ? auth.label : auth.type === "inherit" ? "heredada" : auth.type;
  return null;
}

export function RequestEditor({ tab }: { tab: RequestTab }) {
  const { patch } = useStore.getState();
  return (
    <div className="pane">
      <div className="subtabs" role="tablist" aria-label="Partes de la petición">
        {PANELS.map((p) => {
          const n = panelCount(tab, p.id);
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              className="subtab"
              aria-selected={tab.panel === p.id}
              data-testid={`req-tab-${p.id}`}
              onClick={() => patch(tab.id, { panel: p.id })}
            >
              {p.label} {n && <span className="n">{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="pane-body" role="tabpanel">
        {tab.redactedFromHistory && (
          <p className="notice">Abierta desde el historial: las credenciales no se guardan ahí, vuelve a escribirlas si hacen falta.</p>
        )}
        {tab.notes.length > 0 && (
          <div className="notice" data-testid="import-notes">
            <span>
              Importada desde curl. {tab.notes.join(" ")}
            </span>
            <button type="button" className="link-btn" onClick={() => useStore.getState().patch(tab.id, { notes: [] })}>
              Entendido
            </button>
          </div>
        )}
        {tab.panel === "params" && <ParamsPanel tab={tab} />}
        {tab.panel === "auth" && <AuthPanel tab={tab} />}
        {tab.panel === "headers" && <HeadersPanel tab={tab} />}
        {tab.panel === "body" && <BodyPanel tab={tab} />}
        {tab.panel === "scripts" && <ScriptsPanel tab={tab} />}
        {tab.panel === "settings" && <SettingsPanel tab={tab} />}
      </div>
    </div>
  );
}

function ParamsPanel({ tab }: { tab: RequestTab }) {
  return (
    <>
      <KvTable name="params" rows={tab.params} onChange={(rows) => useStore.getState().setParams(tab.id, rows)} />
      <p className="hint pad">Los parámetros activos forman la cadena de consulta de la URL; desmarca uno para conservarlo sin enviarlo.</p>
      <RequestInsights draft={tab.draft} />
    </>
  );
}

function HeadersPanel({ tab }: { tab: RequestTab }) {
  const setDraft = useStore.getState().setDraft;
  return (
    <>
      <KvTable name="headers" keyLabel="Cabecera" rows={tab.draft.headers} onChange={(headers) => setDraft(tab.id, (d) => ({ ...d, headers }))} />
      <p className="hint pad">
        Sendix añade por su cuenta <span className="mono">User-Agent: Sendix</span>, <span className="mono">Accept</span>, <span className="mono">Host</span> y la
        compresión si no los defines. No añade cabeceras de rastreo.
      </p>
    </>
  );
}

const AUTH_LABEL: Record<Exclude<AuthType, "preserved">, string> = {
  inherit: "Heredar de la carpeta o colección",
  none: "Sin autorización",
  bearer: "Bearer token",
  basic: "Básica (usuario y contraseña)",
  apikey: "Clave de API",
};

function AuthPanel({ tab }: { tab: RequestTab }) {
  const setDraft = useStore.getState().setDraft;
  const auth = tab.draft.auth;
  const setAuth = (next: RequestAuth) => setDraft(tab.id, (d) => ({ ...d, auth: next }));
  const changeType = (type: AuthType) => {
    if (type === "none" || type === "inherit") setAuth({ type });
    else if (type === "preserved") return;
    else if (type === "bearer") setAuth({ type, token: "" });
    else if (type === "basic") setAuth({ type, username: "", password: "" });
    else setAuth({ type, key: "", value: "", in: "header" });
  };
  return (
    <div className="form">
      <label className="field">
        <span>Tipo</span>
        <select value={auth.type} onChange={(e) => changeType(e.target.value as AuthType)} data-testid="auth-type">
          {(Object.keys(AUTH_LABEL) as Array<keyof typeof AUTH_LABEL>)
            .filter((t) => t !== "inherit" || tab.source)
            .map((t) => (
              <option key={t} value={t}>
                {AUTH_LABEL[t]}
              </option>
            ))}
          {auth.type === "preserved" && <option value="preserved">{auth.label} (definida en el archivo)</option>}
        </select>
      </label>
      {auth.type === "bearer" && (
        <label className="field">
          <span>Token</span>
          <input className="mono" type="password" value={auth.token} onChange={(e) => setAuth({ ...auth, token: e.target.value })} data-testid="auth-token" autoComplete="off" />
        </label>
      )}
      {auth.type === "basic" && (
        <>
          <label className="field">
            <span>Usuario</span>
            <input className="mono" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} autoComplete="off" />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input className="mono" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} autoComplete="off" />
          </label>
        </>
      )}
      {auth.type === "apikey" && (
        <>
          <label className="field">
            <span>Nombre</span>
            <input className="mono" value={auth.key} placeholder="X-API-Key" onChange={(e) => setAuth({ ...auth, key: e.target.value })} />
          </label>
          <label className="field">
            <span>Valor</span>
            <input className="mono" type="password" value={auth.value} onChange={(e) => setAuth({ ...auth, value: e.target.value })} autoComplete="off" />
          </label>
          <label className="field">
            <span>Enviar en</span>
            <select value={auth.in} onChange={(e) => setAuth({ ...auth, in: e.target.value as "header" | "query" })}>
              <option value="header">Cabecera</option>
              <option value="query">Parámetro de la URL</option>
            </select>
          </label>
        </>
      )}
      {auth.type === "preserved" && (
        <p className="notice">
          {auth.data == null
            ? `Esta petición usaba ${auth.label}; sus credenciales no se guardan en el historial.`
            : `${auth.label} está definida en el archivo de la colección. Sendix la envía tal cual, pero todavía no permite editarla aquí.`}
        </p>
      )}
      <p className="hint">
        {auth.type === "none"
          ? "La petición se envía sin credenciales."
          : auth.type === "inherit"
            ? "Usa la autorización de la carpeta o, si no tiene, la de la colección."
            : "Los valores se envían solo al ejecutar la petición; el historial nunca guarda tokens ni contraseñas."}
      </p>
    </div>
  );
}

const MODE_LABEL: Record<Exclude<BodyMode, "preserved">, string> = { none: "Ninguno", raw: "Texto o JSON", urlencoded: "x-www-form-urlencoded", formdata: "form-data" };

function BodyPanel({ tab }: { tab: RequestTab }) {
  const setDraft = useStore.getState().setDraft;
  const body = tab.draft.body;
  const setBody = (next: RequestBody) => setDraft(tab.id, (d) => ({ ...d, body: next }));
  const changeMode = (mode: BodyMode) => {
    if (mode === body.mode || mode === "preserved") return;
    if (body.mode === "preserved" && !window.confirm(`El cuerpo actual (${body.label}) se reemplazará. ¿Continuar?`)) return;
    if (mode === "none") setBody({ mode });
    else if (mode === "raw") setBody({ mode, language: "json", raw: "" });
    else setBody({ mode, fields: body.mode === "urlencoded" || body.mode === "formdata" ? body.fields : [] });
  };
  return (
    <>
      <div className="toolbar">
        <span className="seg" role="radiogroup" aria-label="Tipo de cuerpo">
          {(Object.keys(MODE_LABEL) as Array<keyof typeof MODE_LABEL>).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={body.mode === m} aria-pressed={body.mode === m} onClick={() => changeMode(m)} data-testid={`body-mode-${m}`}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </span>
        {body.mode === "raw" && (
          <select className="mini-select" value={body.language} aria-label="Formato" onChange={(e) => setBody({ ...body, language: e.target.value as RawLanguage })}>
            {RAW_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABEL[l]}
              </option>
            ))}
          </select>
        )}
        {body.mode === "raw" && body.language === "json" && (
          <span className="end">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                try {
                  setBody({ ...body, raw: JSON.stringify(JSON.parse(body.raw), null, 2) });
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
      {body.mode === "none" && <p className="hint pad">Esta petición no lleva cuerpo.</p>}
      {body.mode === "preserved" && (
        <p className="notice">
          Cuerpo de tipo {body.label}, definido en el archivo de la colección. Sendix lo envía tal cual, pero todavía no permite editarlo aquí.
        </p>
      )}
      {body.mode === "raw" && (
        <textarea
          className="editor mono"
          value={body.raw}
          spellCheck={false}
          aria-label="Cuerpo de la petición"
          data-testid="body-raw"
          placeholder={body.language === "json" ? '{\n  "nombre": "valor"\n}' : ""}
          onChange={(e) => setBody({ ...body, raw: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = el;
            const raw = `${body.raw.slice(0, s)}  ${body.raw.slice(end)}`;
            setBody({ ...body, raw });
            requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
          }}
        />
      )}
      {(body.mode === "urlencoded" || body.mode === "formdata") && (
        <>
          <KvTable name="form" keyLabel="Campo" rows={body.fields} onChange={(fields) => setBody({ ...body, fields })} />
          {body.mode === "formdata" && <p className="hint pad">Por ahora, form-data envía solo campos de texto; los archivos llegarán con los espacios de trabajo.</p>}
        </>
      )}
    </>
  );
}

const PHASES: Array<{ id: ScriptPhase; label: string; hint: string }> = [
  { id: "prerequest", label: "Antes de la petición", hint: "Se ejecuta antes de enviar: prepara variables, cabeceras o firmas." },
  { id: "test", label: "Después de la respuesta", hint: "Se ejecuta con la respuesta: escribe tests con pm.test y guarda valores para otras peticiones." },
];

function ScriptsPanel({ tab }: { tab: RequestTab }) {
  const { setDraft, patch } = useStore.getState();
  const variables = useStore((s) => s.variables);
  const keysRef = useRef<string[]>([]);
  keysRef.current = variables.map((v) => v.key);
  const completions = useMemo(() => pmCompletions(() => keysRef.current), []);
  const editorBox = useRef<HTMLDivElement>(null);
  const scripts = tab.draft.scripts ?? EMPTY_SCRIPTS;
  const phase = tab.scriptPhase;
  const current = PHASES.find((p) => p.id === phase)!;
  const setScript = (code: string) => setDraft(tab.id, (d) => ({ ...d, scripts: { ...(d.scripts ?? EMPTY_SCRIPTS), [phase]: code } }));

  return (
    <div className="scripts">
      <div className="toolbar">
        <span className="seg" role="radiogroup" aria-label="Momento del script">
          {PHASES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={phase === p.id} aria-pressed={phase === p.id} onClick={() => patch(tab.id, { scriptPhase: p.id })} data-testid={`script-phase-${p.id}`}>
              {p.label}
              {scripts[p.id].trim() ? <span className="dot-on" aria-label="con código" /> : null}
            </button>
          ))}
        </span>
        <span className="hint" title={current.hint}>{current.hint}</span>
      </div>
      <div className="scripts-body">
        <div className="scripts-editor" ref={editorBox}>
          <CodeEditor
            key={phase}
            value={scripts[phase]}
            onChange={setScript}
            language="javascript"
            completions={completions}
            label={`Script: ${current.label.toLowerCase()}`}
            testId={`script-${phase}`}
            placeholder={phase === "test" ? 'pm.test("El estado es 200", () => pm.response.to.have.status(200));' : 'pm.environment.set("ahora", Date.now());'}
          />
        </div>
        <aside className="snippets" aria-label="Fragmentos">
          <p className="snippets-title">Fragmentos</p>
          {SNIPPETS.filter((s) => s.phase === phase).map((s) => (
            <button key={s.label} type="button" className="snippet" onClick={() => insertIntoEditor(editorBox.current, s.code) || setScript(scripts[phase] ? `${scripts[phase]}

${s.code}` : s.code)}>
              {s.label}
            </button>
          ))}
          <p className="snippets-note">
            Los valores que guardan <span className="mono">pm.environment.set</span> y <span className="mono">pm.collectionVariables.set</span> duran hasta cerrar Sendix; no se escriben en los archivos.
          </p>
        </aside>
      </div>
    </div>
  );
}

function SettingsPanel({ tab }: { tab: RequestTab }) {
  const setDraft = useStore.getState().setDraft;
  const s = tab.draft.settings;
  const set = (patch: Partial<typeof s>) => setDraft(tab.id, (d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  return (
    <div className="form">
      <label className="field">
        <span>Tiempo máximo</span>
        <span className="inline">
          <input
            className="mono short"
            type="number"
            min={1}
            max={600}
            value={s.timeoutMs / 1000}
            onChange={(e) => set({ timeoutMs: Math.min(600, Math.max(1, Math.round(Number(e.target.value) || 1))) * 1000 })}
            data-testid="req-timeout"
          />{" "}
          segundos
        </span>
      </label>
      <label className="switch">
        <input type="checkbox" className="check" checked={s.followRedirects} onChange={(e) => set({ followRedirects: e.target.checked })} />
        <span>
          Seguir redirecciones
          <small>Si se desactiva, verás la respuesta 3xx tal cual.</small>
        </span>
      </label>
      <label className="switch">
        <input type="checkbox" className="check" checked={s.verifyTls} onChange={(e) => set({ verifyTls: e.target.checked })} data-testid="verify-tls" />
        <span>
          Verificar el certificado TLS
          <small>Desactívalo solo para servidores de prueba con certificados propios.</small>
        </span>
      </label>
      {!s.verifyTls && (
        <p className="notice warn">
          <Icon name="x" size={14} /> La verificación TLS está desactivada en esta petición.
        </p>
      )}

      <div className="section-label flush">
        Avanzado <span>«Heredar» usa lo que digan la carpeta o la colección; si no dicen nada, el comportamiento normal</span>
      </div>
      <label className="field">
        <span>Máximo de redirecciones</span>
        <span className="inline">
          <input
            className="mono short"
            type="number"
            min={0}
            max={100}
            placeholder="10"
            value={s.maxRedirects ?? ""}
            onChange={(e) => set({ maxRedirects: e.target.value === "" ? undefined : Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
            data-testid="req-max-redirects"
          />
          {s.maxRedirects === undefined && <span className="hint">heredado</span>}
        </span>
      </label>
      {TRI_STATE.map(([key, label, help]) => (
        <label className="field top" key={key}>
          <span>{label}</span>
          <span className="tri">
            <select
              className="mini-select"
              value={s[key] === undefined ? "" : s[key] ? "yes" : "no"}
              onChange={(e) => set({ [key]: e.target.value === "" ? undefined : e.target.value === "yes" })}
              data-testid={`req-${key}`}
            >
              <option value="">Heredar</option>
              <option value="yes">Sí</option>
              <option value="no">No</option>
            </select>
            <small>{help}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

const TRI_STATE: Array<["followOriginalHttpMethod" | "followAuthorizationHeader" | "removeRefererHeaderOnRedirect" | "disableUrlEncoding" | "disableCookies", string, string]> = [
  ["followOriginalHttpMethod", "Método original al redirigir", "Repite POST, PUT… en lugar de cambiar a GET (por defecto, no)."],
  ["followAuthorizationHeader", "Authorization al redirigir", "Mantiene la cabecera aunque la redirección vaya a otro dominio (por defecto, no)."],
  ["removeRefererHeaderOnRedirect", "Quitar Referer al redirigir", "No envía la cabecera Referer en el siguiente salto (por defecto, no)."],
  ["disableUrlEncoding", "Enviar la URL sin codificar", "Tal cual la escribiste, sin convertir espacios ni acentos (por defecto, no)."],
  ["disableCookies", "Sin cookies", "Ni envía ni guarda cookies en esta petición (por defecto, no)."],
];

import { useEffect, useState } from "react";
import type { AppInfo } from "@shared/ipc";
import { DEFAULT_PREFS, type Prefs, type Theme } from "@shared/prefs";
import { useStore } from "../state/store";
import { Icon } from "../Icon";
import { NetworkSettings } from "./NetworkSettings";

const THEME_OPTIONS: Array<{ id: Theme; label: string; hint: string }> = [
  { id: "system", label: "Sistema", hint: "Sigue a Windows" },
  { id: "light", label: "Claro", hint: "Siempre claro" },
  { id: "dark", label: "Oscuro", hint: "Siempre oscuro" },
];

/** Number input that only commits (clamped) on blur or Enter, so typing "16" never passes through "1". */
function NumberField({ value, min, max, onCommit, testId, label }: { value: number; min: number; max: number; onCommit: (n: number) => void; testId: string; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    const next = Number.isFinite(n) && text.trim() !== "" ? Math.min(max, Math.max(min, n)) : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="mono short"
      type="number"
      min={min}
      max={max}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      data-testid={testId}
    />
  );
}

export function SettingsView() {
  const prefs = useStore((s) => s.prefs);
  const save = (update: (p: Prefs) => Prefs) => void useStore.getState().savePrefs(update);
  const editor = (patch: Partial<Prefs["editor"]>) => save((p) => ({ ...p, editor: { ...p.editor, ...patch } }));
  const request = (patch: Partial<Prefs["request"]>) => save((p) => ({ ...p, request: { ...p.request, ...patch } }));
  const isDefault = JSON.stringify(prefs) === JSON.stringify(DEFAULT_PREFS);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void window.sendix.app.info().then(setInfo), []);
  const clearHistory = () => {
    if (!window.confirm("Se borrará todo el historial de peticiones de este equipo. ¿Continuar?")) return;
    void window.sendix.history.clear().then((ok) => useStore.getState().notify(ok ? "ok" : "err", ok ? "Historial borrado." : "No se pudo borrar el historial."));
  };

  return (
    <div className="system settings" data-testid="settings">
      <div className="page-head">
        <h1>Ajustes</h1>
        <span className="page-sub">Se guardan en este equipo y se aplican al momento</span>
        <button type="button" className="link-btn reset" disabled={isDefault} onClick={() => save(() => DEFAULT_PREFS)} data-testid="prefs-reset">
          Restablecer valores predeterminados
        </button>
      </div>

      <div className="grid">
        <section className="panel" aria-labelledby="look-h">
          <div className="panel-head">
            <h2 id="look-h">Apariencia</h2>
          </div>
          <div className="theme-pick" role="radiogroup" aria-label="Tema">
            {THEME_OPTIONS.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={prefs.theme === o.id} className="theme-option" onClick={() => save((p) => ({ ...p, theme: o.id }))} data-testid={`theme-${o.id}`}>
                <span className={`theme-swatch ${o.id}`} aria-hidden="true">
                  <span className="sw-rail" />
                  <span className="sw-work">
                    <span className="sw-line" />
                    <span className="sw-line short" />
                    <span className="sw-accent" />
                  </span>
                </span>
                <span className="theme-text">
                  <b>{o.label}</b>
                  <small>{o.hint}</small>
                </span>
                {prefs.theme === o.id && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>

          <div className="panel-head sub">
            <h2>Editor de código</h2>
          </div>
          <div className="form prefs-form">
            <label className="field">
              <span>Tamaño de letra</span>
              <span className="inline">
                <NumberField value={prefs.editor.fontSize} min={11} max={20} onCommit={(fontSize) => editor({ fontSize })} testId="pref-font-size" label="Tamaño de letra del código" /> px
              </span>
            </label>
            <div className="field">
              <span>Sangría</span>
              <div className="seg" role="group" aria-label="Sangría">
                {([2, 4] as const).map((n) => (
                  <button key={n} type="button" aria-pressed={prefs.editor.tabSize === n} onClick={() => editor({ tabSize: n })} data-testid={`pref-tab-${n}`}>
                    {n} espacios
                  </button>
                ))}
              </div>
            </div>
            <label className="switch">
              <input type="checkbox" className="check" checked={prefs.editor.closeBrackets} onChange={(e) => editor({ closeBrackets: e.target.checked })} />
              <span>
                Cerrar llaves y comillas automáticamente
                <small>Al escribir {"{"}, [ o " se añade su cierre.</small>
              </span>
            </label>
            <p className="code-sample mono" aria-hidden="true">
              {"{ \"producto\": \"Café de Veracruz\", \"precio\": 189 }"}
            </p>
          </div>
        </section>

        <section className="panel" aria-labelledby="req-h">
          <div className="panel-head">
            <h2 id="req-h">Peticiones</h2>
          </div>
          <div className="form prefs-form">
            <label className="field">
              <span>Tiempo máximo</span>
              <span className="inline">
                <NumberField value={prefs.request.timeoutMs / 1000} min={1} max={600} onCommit={(s) => request({ timeoutMs: s * 1000 })} testId="pref-timeout" label="Tiempo máximo en segundos" /> segundos
              </span>
            </label>
            <p className="hint field-note">Para peticiones nuevas y al abrir o ejecutar las guardadas. Cada pestaña puede cambiarlo en sus ajustes.</p>
            <label className="field">
              <span>Tamaño máximo</span>
              <span className="inline">
                <NumberField value={prefs.request.maxResponseMb} min={1} max={500} onCommit={(maxResponseMb) => request({ maxResponseMb })} testId="pref-max-size" label="Tamaño máximo de respuesta en MB" /> MB por respuesta
              </span>
            </label>
            <label className="switch">
              <input type="checkbox" className="check" checked={prefs.request.verifyTls} onChange={(e) => request({ verifyTls: e.target.checked })} data-testid="pref-verify-tls" />
              <span>
                Verificar certificados TLS
                <small>Desactivado, ninguna conexión los verifica: HTTP, WebSocket, Socket.IO ni gRPC.</small>
              </span>
            </label>
            {!prefs.request.verifyTls && (
              <p className="notice warn" data-testid="pref-tls-off">
                <Icon name="x" size={14} /> Sendix no comprueba certificados en ninguna petición. Úsalo solo con servidores de prueba.
              </p>
            )}
            <label className="switch">
              <input type="checkbox" className="check" checked={prefs.request.followRedirects} onChange={(e) => request({ followRedirects: e.target.checked })} data-testid="pref-redirects" />
              <span>
                Seguir redirecciones
                <small>Desactivado, verás la respuesta 3xx en todas las peticiones.</small>
              </span>
            </label>
            <label className="switch">
              <input type="checkbox" className="check" checked={prefs.request.sendNoCache} onChange={(e) => request({ sendNoCache: e.target.checked })} data-testid="pref-no-cache" />
              <span>
                Enviar <span className="mono">Cache-Control: no-cache</span>
                <small>Salvo en las peticiones que ya definen Cache-Control.</small>
              </span>
            </label>
          </div>
        </section>
      </div>

      <NetworkSettings />

      <section className="panel data" aria-labelledby="data-h">
        <div className="panel-head">
          <h2 id="data-h">Datos de este equipo</h2>
        </div>
        <dl className="facts">
          <dt>Carpeta del perfil</dt>
          <dd>
            <span className="mono" data-testid="profile-path">{info?.userData ?? "—"}</span>
            <button type="button" className="link-btn" onClick={() => void window.sendix.prefs.revealProfile()}>
              Mostrar en el explorador
            </button>
          </dd>
          <dt>Historial</dt>
          <dd>
            <span>Las peticiones enviadas, con las credenciales ocultas. Las colecciones de tu carpeta de trabajo no se tocan.</span>
            <button type="button" className="link-btn danger" onClick={clearHistory} data-testid="prefs-clear-history">
              Borrar historial
            </button>
          </dd>
          <dt>Versión</dt>
          <dd>
            <span className="mono">{info ? `Sendix ${info.version}${info.packaged ? "" : " (desarrollo)"}` : "—"}</span>
            <button type="button" className="link-btn" onClick={() => useStore.getState().openSystem()}>
              Estado del sistema y actualizaciones
            </button>
          </dd>
        </dl>
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { parseProxyServer, type ClientCert, type NetworkPrefs, type Prefs } from "@shared/prefs";
import { useStore } from "../state/store";
import { Icon } from "../Icon";

/** Text input that saves on blur or Enter, not on every key. */
function TextField({ value, onCommit, testId, label, placeholder, mono = true }: { value: string; onCommit: (v: string) => void; testId: string; label: string; placeholder?: string; mono?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text.trim());
  return (
    <input
      className={mono ? "mono" : undefined}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      data-testid={testId}
    />
  );
}

const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : "");

/** Proxy, extra CA and client certificates. Files are picked in main; passwords go to the encrypted store. */
export function NetworkSettings() {
  const network = useStore((s) => s.prefs.network);
  const notify = useStore.getState().notify;
  const save = (update: (n: NetworkPrefs) => NetworkPrefs) => void useStore.getState().savePrefs((p: Prefs) => ({ ...p, network: update(p.network) }));
  const proxy = (patch: Partial<NetworkPrefs["proxy"]>) => save((n) => ({ ...n, proxy: { ...n.proxy, ...patch } }));
  const [secrets, setSecrets] = useState<{ proxyPassword: boolean; certPassphrases: string[] }>({ proxyPassword: false, certPassphrases: [] });
  const refreshSecrets = useCallback(() => void window.sendix.prefs.secrets().then((s) => s && setSecrets(s)), []);
  useEffect(refreshSecrets, [refreshSecrets, network]);
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<{ host: string; certFile: string | null; keyFile: string | null; pfxFile: string | null; passphrase: string }>({ host: "", certFile: null, keyFile: null, pfxFile: null, passphrase: "" });

  const savePassword = async () => {
    const ok = await window.sendix.prefs.setSecret("proxy", password || null);
    setPassword("");
    refreshSecrets();
    notify(ok ? "ok" : "err", ok ? (password ? "Contraseña del proxy guardada, cifrada." : "Contraseña del proxy borrada.") : "No se pudo guardar la contraseña.");
  };
  const pick = async (kind: "cert" | "key" | "pfx") => {
    const path = await window.sendix.prefs.pickFile(kind);
    if (path) setDraft((d) => (kind === "pfx" ? { ...d, pfxFile: path, certFile: null, keyFile: null } : { ...d, [`${kind}File`]: path, pfxFile: null }));
  };
  const canAdd = draft.host.trim() !== "" && (draft.pfxFile !== null || (draft.certFile !== null && draft.keyFile !== null));
  const addCert = async () => {
    const cert: ClientCert = { id: crypto.randomUUID(), host: draft.host.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, ""), certFile: draft.certFile, keyFile: draft.keyFile, pfxFile: draft.pfxFile };
    await useStore.getState().savePrefs((p) => ({ ...p, network: { ...p.network, clientCerts: [...p.network.clientCerts, cert] } }));
    if (draft.passphrase) await window.sendix.prefs.setSecret(`cert:${cert.id}`, draft.passphrase);
    setDraft({ host: "", certFile: null, keyFile: null, pfxFile: null, passphrase: "" });
    refreshSecrets();
  };
  const serverInvalid = network.proxy.mode === "custom" && network.proxy.server !== "" && !parseProxyServer(network.proxy.server);

  return (
    <section className="panel net" aria-labelledby="net-h">
      <div className="panel-head">
        <h2 id="net-h">Red y certificados</h2>
        <span className="count">peticiones HTTP</span>
      </div>
      <div className="net-grid">
        <div className="form prefs-form">
          <div className="field">
            <span>Proxy</span>
            <div className="seg" role="group" aria-label="Proxy">
              {(
                [
                  ["none", "Sin proxy"],
                  ["system", "Del sistema"],
                  ["custom", "Propio"],
                ] as const
              ).map(([mode, label]) => (
                <button key={mode} type="button" aria-pressed={network.proxy.mode === mode} onClick={() => proxy({ mode })} data-testid={`proxy-${mode}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {network.proxy.mode === "system" && <p className="hint field-note">Sendix pregunta a Windows qué proxy usar para cada URL, también con archivos PAC.</p>}
          {network.proxy.mode === "custom" && (
            <>
              <label className="field">
                <span>Servidor</span>
                <TextField value={network.proxy.server} onCommit={(server) => proxy({ server })} testId="pref-proxy-server" label="Servidor proxy" placeholder="proxy.empresa.test:3128" />
              </label>
              {serverInvalid && <p className="notice warn field-note-notice">Escribe el servidor como host:puerto o http://host:puerto.</p>}
              <label className="field">
                <span>Usuario</span>
                <TextField value={network.proxy.username} onCommit={(username) => proxy({ username })} testId="pref-proxy-user" label="Usuario del proxy" placeholder="Sin autenticación" />
              </label>
              {network.proxy.username && (
                <div className="field">
                  <span>Contraseña</span>
                  <span className="inline">
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={secrets.proxyPassword ? "Guardada (escribe para cambiarla)" : "Sin guardar"} aria-label="Contraseña del proxy" data-testid="pref-proxy-password" />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void savePassword()} data-testid="pref-proxy-password-save">
                      {password ? "Guardar" : secrets.proxyPassword ? "Borrar" : "Guardar"}
                    </button>
                  </span>
                </div>
              )}
            </>
          )}
          {network.proxy.mode !== "none" && (
            <label className="field">
              <span>Excepciones</span>
              <TextField value={network.proxy.bypass} onCommit={(bypass) => proxy({ bypass })} testId="pref-proxy-bypass" label="Hosts sin proxy" placeholder="localhost, *.interno.test" />
            </label>
          )}
          {network.proxy.mode !== "none" && <p className="hint field-note">Separadas por comas: nombres exactos, *.dominio o .dominio. El proxy no se aplica a WebSocket, Socket.IO ni gRPC.</p>}
        </div>

        <div className="form prefs-form">
          <div className="field">
            <span>CA propia</span>
            <span className="inline file-pick">
              {network.caFile ? (
                <span className="mono file-name" title={network.caFile} data-testid="pref-ca-file">
                  {fileName(network.caFile)}
                </span>
              ) : (
                <span className="hint">Solo las del sistema</span>
              )}
              <button
                type="button"
                className="link-btn"
                onClick={() => void window.sendix.prefs.pickFile("ca").then((caFile) => caFile && save((n) => ({ ...n, caFile })))}
                data-testid="pref-ca-pick"
              >
                {network.caFile ? "Cambiar…" : "Elegir PEM…"}
              </button>
              {network.caFile && (
                <button type="button" className="link-btn" onClick={() => save((n) => ({ ...n, caFile: null }))}>
                  Quitar
                </button>
              )}
            </span>
          </div>
          <p className="hint field-note">Se confía en ella además de en las del sistema; útil para servidores internos con su propia CA.</p>

          <div className="field top">
            <span>Certificados de cliente</span>
            <div className="certs">
              {network.clientCerts.length === 0 && <p className="hint">Ninguno. Se envían solo al host y puerto indicados.</p>}
              {network.clientCerts.map((c) => (
                <div className="cert-row" key={c.id} data-testid="client-cert">
                  <Icon name="lock" size={14} />
                  <span className="mono">{c.host}</span>
                  <span className="muted mono">{c.pfxFile ? fileName(c.pfxFile) : `${fileName(c.certFile)} + ${fileName(c.keyFile)}`}</span>
                  {secrets.certPassphrases.includes(c.id) && <span className="muted">con contraseña</span>}
                  <button type="button" className="icon-btn" aria-label={`Quitar el certificado de ${c.host}`} onClick={() => save((n) => ({ ...n, clientCerts: n.clientCerts.filter((x) => x.id !== c.id) }))}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
              <div className="cert-add">
                <input className="mono" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="api.empresa.test:8443" aria-label="Host del certificado" data-testid="cert-host" />
                <span className="cert-files">
                  <button type="button" className="link-btn" onClick={() => void pick("cert")} data-testid="cert-pick-cert">
                    {draft.certFile ? fileName(draft.certFile) : "CRT…"}
                  </button>
                  <button type="button" className="link-btn" onClick={() => void pick("key")} data-testid="cert-pick-key">
                    {draft.keyFile ? fileName(draft.keyFile) : "KEY…"}
                  </button>
                  <span className="muted">o</span>
                  <button type="button" className="link-btn" onClick={() => void pick("pfx")}>
                    {draft.pfxFile ? fileName(draft.pfxFile) : "PFX…"}
                  </button>
                </span>
                <input type="password" value={draft.passphrase} onChange={(e) => setDraft({ ...draft, passphrase: e.target.value })} placeholder="Contraseña (opcional)" aria-label="Contraseña del certificado" />
                <button type="button" className="btn btn-secondary btn-sm" disabled={!canAdd} onClick={() => void addCert()} data-testid="cert-add">
                  Añadir
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { CURL_SHELLS, CURL_SHELL_LABEL, type CurlBuildResult, type CurlShell } from "@shared/curl-export";
import { parseCurl } from "@shared/curl";
import { useStore } from "../state/store";

const SHELL_HINT: Record<CurlShell, string> = {
  bash: "Linux, macOS, Git Bash o WSL.",
  cmd: "Símbolo del sistema de Windows.",
  powershell: "Windows PowerShell 5.1 y PowerShell 7 (usa curl.exe).",
};

/**
 * «Copiar como cURL»: main builds the command, with inherited auth and variables. The
 * preview never shows secrets; with «Incluir secretos» main copies them straight to the clipboard.
 */
export function CurlDialog() {
  const tabId = useStore((s) => s.curlTabId);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.curlTabId));
  const shell = useStore((s) => s.prefs.ui.curlShell);
  const variables = useStore((s) => s.variables);
  const dialog = useRef<HTMLDialogElement>(null);
  const [resolveVariables, setResolveVariables] = useState(true);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [result, setResult] = useState<CurlBuildResult>(null);
  const request = tab?.kind === "request" ? tab : null;

  useEffect(() => {
    if (!tabId) return;
    // Secrets are opt-in every time the dialog opens.
    setIncludeSecrets(false);
    setResult(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [tabId]);

  useEffect(() => {
    if (!request) return;
    let alive = true;
    const options = { shell, resolveVariables, includeSecrets };
    void window.sendix.curl.build({ request: request.draft, source: request.source, options, copy: false }).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [request?.draft, request?.source, shell, resolveVariables, includeSecrets, variables]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tabId) return null;
  const close = () => {
    dialog.current?.close();
    useStore.getState().closeCurl();
  };
  const setShell = (curlShell: CurlShell) => void useStore.getState().savePrefs((p) => ({ ...p, ui: { ...p.ui, curlShell } }));
  const toggleSecrets = (on: boolean) => {
    if (on && !window.confirm("Los secretos y las credenciales se copiarán tal cual al portapapeles, donde otras apps pueden leerlos. ¿Incluirlos?")) return;
    setIncludeSecrets(on);
  };
  const copy = async () => {
    if (!request) return;
    const r = await window.sendix.curl.build({ request: request.draft, source: request.source, options: { shell, resolveVariables, includeSecrets }, copy: true });
    if (!r?.copied) return useStore.getState().notify("err", "No se pudo generar el comando cURL.");
    useStore.getState().notify("ok", includeSecrets ? "Comando cURL copiado, con los secretos." : "Comando cURL copiado.");
    close();
  };

  return (
    <dialog ref={dialog} className="dialog curl-dialog" onCancel={close} aria-labelledby="curl-title" data-testid="curl-dialog">
      <h2 id="curl-title">Copiar como cURL</h2>
      <div className="curl-shells">
        <div className="seg" role="group" aria-label="Terminal">
          {CURL_SHELLS.map((s) => (
            <button key={s} type="button" aria-pressed={shell === s} onClick={() => setShell(s)} data-testid={`curl-shell-${s}`}>
              {CURL_SHELL_LABEL[s]}
            </button>
          ))}
        </div>
        <span className="hint">{SHELL_HINT[shell]}</span>
      </div>
      <label className="switch">
        <input type="checkbox" className="check" checked={resolveVariables} onChange={(e) => setResolveVariables(e.target.checked)} data-testid="curl-resolve" />
        <span>
          Sustituir las variables por sus valores
          <small>Usa el entorno activo. Desactívalo para dejar cada {"{{variable}}"} escrita.</small>
        </span>
      </label>
      <label className="switch">
        <input type="checkbox" className="check" checked={includeSecrets} onChange={(e) => toggleSecrets(e.target.checked)} data-testid="curl-secrets" />
        <span>
          Incluir secretos y credenciales
          <small>Variables secretas, tokens, contraseñas y las cabeceras Authorization y Cookie. Aquí siguen ocultos; solo van al portapapeles.</small>
        </span>
      </label>
      <pre className="curl-preview mono" data-testid="curl-preview">
        {result ? result.command : request ? "Generando…" : "Esta pestaña no es una petición HTTP."}
      </pre>
      {result && result.notes.length > 0 && (
        <ul className="curl-notes" data-testid="curl-notes">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={close}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!result} onClick={() => void copy()} data-testid="curl-copy">
          Copiar
        </button>
      </div>
    </dialog>
  );
}

/** Pastes a cURL command (bash, cmd or PowerShell) and opens it as a new, unsaved request. */
export function CurlImportDialog() {
  const open = useStore((s) => s.curlImportOpen);
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setError(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  if (!open) return null;
  const close = () => {
    dialog.current?.close();
    useStore.getState().setCurlImport(false);
  };
  const submit = () => {
    const parsed = parseCurl(text);
    if (!parsed) return setError("No parece un comando curl con una URL.");
    useStore.getState().newRequest(parsed.request, { notes: parsed.notes });
    useStore.getState().notify("ok", "Comando curl convertido en petición: guárdala con Ctrl S.");
    close();
  };

  return (
    <dialog ref={dialog} className="dialog curl-dialog" onCancel={close} aria-labelledby="curl-import-title" data-testid="curl-import-dialog">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="curl-import-title">Importar un comando cURL</h2>
        <p className="hint">Pega el comando tal cual, de bash, cmd o PowerShell (también el de «Copy as cURL» del navegador). Se abre en una pestaña nueva sin guardar; nada se envía hasta que pulses Enviar.</p>
        <textarea
          className="curl-input mono"
          value={text}
          onChange={(e) => (setText(e.target.value), setError(null))}
          placeholder="curl https://api.ejemplo.com/recurso -H 'Accept: application/json'"
          spellCheck={false}
          autoFocus
          aria-label="Comando cURL"
          data-testid="curl-import-text"
        />
        {error && (
          <p className="notice warn" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()} data-testid="curl-import-open">
            Abrir en una pestaña
          </button>
        </div>
      </form>
    </dialog>
  );
}

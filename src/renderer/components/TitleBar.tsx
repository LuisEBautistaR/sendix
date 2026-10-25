import { useEffect, useRef, useState } from "react";
import { useStore, ws } from "../state/store";
import { Icon } from "../Icon";

const fail = (err: unknown) => useStore.getState().notify("err", err instanceof Error ? err.message : String(err));

/** Draggable title bar: wordmark, workspace menu and active environment. Native window buttons overlay the right edge. */
export function TitleBar() {
  const workspace = useStore((s) => s.workspace);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Array<{ path: string; name: string }>>([]);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void ws("recent", {}).then(setRecent, () => setRecent([]));
    const onDown = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = (fn: () => Promise<unknown>) => () => {
    setOpen(false);
    void fn().catch(fail);
  };

  return (
    <header className="titlebar">
      <span className="wordmark">Sendix</span>
      <div className="no-drag" ref={menu}>
        <button type="button" className="crumb" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} data-testid="workspace-menu" title={workspace?.path}>
          <b>{workspace?.name ?? "Sin carpeta de trabajo"}</b>
          <Icon name="down" size={14} />
        </button>
        {open && (
          <div className="menu title-menu" role="menu">
            <button type="button" role="menuitem" onClick={act(() => ws("openFolder", {}))}>
              Abrir o crear carpeta…
            </button>
            {workspace && (
              <>
                <button type="button" role="menuitem" onClick={act(() => ws("reveal", {}))}>
                  Mostrar en el explorador
                </button>
                <button type="button" role="menuitem" onClick={act(() => ws("close", {}))}>
                  Cerrar carpeta
                </button>
              </>
            )}
            {recent.filter((r) => r.path !== workspace?.path).length > 0 && <p className="menu-label">Recientes</p>}
            {recent
              .filter((r) => r.path !== workspace?.path)
              .map((r) => (
                <button key={r.path} type="button" role="menuitem" title={r.path} onClick={act(() => ws("openRecent", { path: r.path }))}>
                  {r.name}
                  <span className="menu-sub mono">{r.path}</span>
                </button>
              ))}
          </div>
        )}
      </div>
      {workspace && (
        <label className="env no-drag" title="Entorno activo: sus variables se usan al enviar">
          <span className="dot" aria-hidden="true" />
          <span className="env-label">Entorno</span>
          <select
            value={workspace.activeEnvironmentId ?? ""}
            onChange={(e) =>
              void ws("setActiveEnvironment", { environmentId: e.target.value || null })
                .then(() => useStore.getState().refreshVariables())
                .catch(fail)
            }
            aria-label="Entorno activo"
            data-testid="environment-select"
          >
            <option value="">Sin entorno</option>
            {workspace.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </header>
  );
}

export function Notices() {
  const notices = useStore((s) => s.notices);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`toast ${n.tone}`} role={n.tone === "err" ? "alert" : "status"} data-testid="toast">
          <span>{n.text}</span>
          <button type="button" className="icon-btn" aria-label="Cerrar aviso" onClick={() => useStore.getState().dismiss(n.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

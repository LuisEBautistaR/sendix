import { useState } from "react";
import type { FolderSettings, FolderVariable } from "@shared/collection";
import { useStore, isFolderDirty, type FolderPanel, type FolderTab } from "../state/store";
import { Icon } from "../Icon";
import { AuthFields, ScriptsEditor } from "./RequestPane";

const PANELS: Array<{ id: FolderPanel; label: string }> = [
  { id: "overview", label: "Resumen" },
  { id: "auth", label: "Autorización" },
  { id: "scripts", label: "Scripts" },
  { id: "variables", label: "Variables" },
];

const AUTH_NAME: Record<string, string> = {
  inherit: "heredada",
  none: "ninguna",
  bearer: "Bearer",
  basic: "Básica",
  apikey: "Clave de API",
};
const authName = (auth: FolderSettings["auth"]) => (auth.type === "preserved" ? auth.label : AUTH_NAME[auth.type]!);
const scriptCount = (d: FolderSettings) => [d.scripts.prerequest, d.scripts.test].filter((s) => s.trim()).length;

function panelBadge(id: FolderPanel, draft: FolderSettings): string | null {
  if (id === "scripts") return scriptCount(draft) ? String(scriptCount(draft)) : null;
  if (id === "variables") return draft.variables.length ? String(draft.variables.length) : null;
  if (id === "auth") return draft.auth.type === "inherit" || draft.auth.type === "none" ? null : authName(draft.auth);
  return null;
}

/** Scripts, auth and variables of a collection or folder: what runs and applies around every request inside it. */
export function FolderEditor({ tab }: { tab: FolderTab }) {
  const collection = useStore((s) => s.workspace?.collections.find((c) => c.id === tab.collectionId));
  const { patchFolder, saveFolder, openRunner } = useStore.getState();
  const { view, draft } = tab;
  if (!view || !draft) return <section className="screen folder-editor" data-testid="folder-editor" aria-busy="true" />;

  const isCollection = tab.folderId === null;
  const dirty = isFolderDirty(tab);
  const set = (patch: Partial<FolderSettings>) => patchFolder(tab.id, { draft: { ...draft, ...patch } });

  return (
    <section className="screen folder-editor" data-testid="folder-editor">
      {!isCollection && (
        <div className="breadcrumb">
          {[collection?.name ?? "Colección", ...view.path].map((p, i) => (
            <span key={i}>
              {i > 0 && " / "}
              {p}
            </span>
          ))}
          <span> / </span>
          <b>{view.name}</b>
        </div>
      )}
      <div className="reqline">
        <Icon name={isCollection ? "box" : "folder"} size={16} />
        <h2 className="folder-title" data-testid="folder-name">
          {view.name}
        </h2>
        <span className="hint">
          {isCollection ? "Colección" : "Carpeta"} · {view.requests === 1 ? "1 petición" : `${view.requests} peticiones`}
        </span>
        <span className="end">
          <button type="button" className="btn" onClick={() => openRunner(tab.collectionId, tab.folderId)} disabled={view.requests === 0}>
            <Icon name="run" size={14} /> Ejecutar…
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void saveFolder(tab.id)} data-testid="folder-save">
            <Icon name="save" size={14} /> Guardar <kbd>Ctrl S</kbd>
          </button>
        </span>
      </div>
      <div className="pane">
        <div className="subtabs" role="tablist" aria-label={isCollection ? "Partes de la colección" : "Partes de la carpeta"}>
          {PANELS.map((p) => {
            const n = panelBadge(p.id, draft);
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                className="subtab"
                aria-selected={tab.panel === p.id}
                data-testid={`folder-tab-${p.id}`}
                onClick={() => patchFolder(tab.id, { panel: p.id })}
              >
                {p.label} {n && <span className="n">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="pane-body" role="tabpanel">
          {tab.panel === "overview" && <Overview tab={tab} />}
          {tab.panel === "auth" && <AuthFields auth={draft.auth} onChange={(auth) => set({ auth })} level={isCollection ? "collection" : "folder"} />}
          {tab.panel === "scripts" && (
            <ScriptsEditor
              scripts={draft.scripts}
              onChange={(phase, code) => set({ scripts: { ...draft.scripts, [phase]: code } })}
              phase={tab.scriptPhase}
              onPhase={(scriptPhase) => patchFolder(tab.id, { scriptPhase })}
              collectionId={tab.collectionId}
              levels={view.inherited}
            />
          )}
          {tab.panel === "variables" && <Variables tab={tab} rows={draft.variables} onChange={(variables) => set({ variables })} />}
        </div>
      </div>
    </section>
  );
}

function Overview({ tab }: { tab: FolderTab }) {
  const { patchFolder, openFolder } = useStore.getState();
  const view = tab.view!;
  const draft = tab.draft!;
  const isCollection = tab.folderId === null;
  const go = (panel: FolderPanel) => () => patchFolder(tab.id, { panel });
  const off = draft.variables.filter((v) => !v.enabled).length;
  const secret = draft.variables.filter((v) => v.secret).length;
  const phases = [draft.scripts.prerequest.trim() && "antes de cada petición", draft.scripts.test.trim() && "después de cada respuesta"].filter(Boolean).join(" y ");
  return (
    <div className="folder-overview" data-testid="folder-overview">
      <ul className="facts">
        <li>
          <button type="button" className="fact" onClick={go("scripts")}>
            <span className="fact-label">Scripts</span>
            <span className="fact-text">{phases ? `Se ejecutan ${phases}.` : "Sin scripts propios."}</span>
          </button>
        </li>
        <li>
          <button type="button" className="fact" onClick={go("variables")}>
            <span className="fact-label">Variables</span>
            <span className="fact-text">
              {draft.variables.length === 0
                ? "Ninguna."
                : `${draft.variables.length} ${draft.variables.length === 1 ? "variable" : "variables"}${off ? `, ${off} desactivadas` : ""}${secret ? `, ${secret} secretas` : ""}.`}
              {!isCollection && draft.variables.length > 0 && " Postman no las usa al enviar."}
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="fact" onClick={go("auth")}>
            <span className="fact-label">Autorización</span>
            <span className="fact-text">
              {draft.auth.type === "inherit"
                ? "Hereda la de la carpeta superior o la colección."
                : draft.auth.type === "none"
                  ? isCollection
                    ? "Ninguna."
                    : "Ninguna: las peticiones que heredan van sin credenciales."
                  : `${authName(draft.auth)}, para las peticiones de dentro que heredan.`}
            </span>
          </button>
        </li>
        {view.inherited.length > 0 && (
          <li className="fact static">
            <span className="fact-label">Antes</span>
            <span className="fact-text">
              Corren primero los scripts de{" "}
              {view.inherited.map((l, i) => (
                <span key={l.folderId ?? "collection"}>
                  {i > 0 && " → "}
                  <button type="button" className="link-btn" onClick={() => openFolder(tab.collectionId, l.folderId, "scripts")}>
                    {l.name}
                  </button>
                </span>
              ))}
              .
            </span>
          </li>
        )}
      </ul>
      <h3 className="overview-head">Descripción</h3>
      {view.description.trim() ? (
        <p className="description" data-testid="folder-description">
          {view.description}
        </p>
      ) : (
        <p className="hint">{isCollection ? "La colección" : "La carpeta"} no tiene descripción.</p>
      )}
    </div>
  );
}

function Variables({ tab, rows, onChange }: { tab: FolderTab; rows: FolderVariable[]; onChange(rows: FolderVariable[]): void }) {
  const [query, setQuery] = useState("");
  const [reveal, setReveal] = useState(false);
  const isCollection = tab.folderId === null;

  if (!isCollection && rows.length === 0) {
    return (
      <div className="empty-panel">
        <p>En Postman las carpetas no tienen variables propias: las peticiones usan las de la colección, las del entorno activo y las que crean los scripts.</p>
        <button type="button" className="btn btn-sm" onClick={() => useStore.getState().openFolder(tab.collectionId, null, "variables")}>
          <Icon name="box" size={14} /> Ver las variables de la colección
        </button>
      </div>
    );
  }

  const update = (i: number, patch: Partial<FolderVariable>) =>
    onChange(i === rows.length ? [...rows, { key: "", value: "", enabled: true, secret: false, ...patch }] : rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const q = query.trim().toLowerCase();
  const shown = rows.map((row, i) => ({ row, i })).filter(({ row }) => !q || row.key.toLowerCase().includes(q) || (!row.secret && row.value.toLowerCase().includes(q)));
  const readOnly = !isCollection;

  return (
    <div className="folder-vars">
      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar variable" aria-label="Buscar variable" data-testid="folder-var-search" />
        </label>
        <span className="hint">{q ? `${shown.length} de ${rows.length}` : rows.length === 1 ? "1 variable" : `${rows.length} variables`}</span>
        {rows.some((r) => r.secret) && (
          <label className="switch inline-switch end">
            <input type="checkbox" className="check" checked={reveal} onChange={(e) => setReveal(e.target.checked)} data-testid="folder-var-reveal" />
            <span>Mostrar secretas</span>
          </label>
        )}
      </div>
      {readOnly && (
        <p className="notice">Esta carpeta trae variables en el archivo, pero Postman y Sendix no las usan al enviar: solo cuentan las de la colección y las del entorno.</p>
      )}
      <table className="kv editable env-table" data-testid="folder-var-table">
        <colgroup>
          <col style={{ width: 34 }} />
          <col style={{ width: "30%" }} />
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 34 }} />
        </colgroup>
        <thead>
          <tr>
            <th />
            <th>Variable</th>
            <th>Valor</th>
            <th>Secreta</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...shown, ...(readOnly || q ? [] : [{ row: null, i: rows.length }])].map(({ row, i }) => (
            <tr key={i} className={row && !row.enabled ? "off" : undefined} title={row?.description}>
              <td className="ck">
                {row && (
                  <input
                    type="checkbox"
                    className="check"
                    checked={row.enabled}
                    disabled={readOnly}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                    aria-label={`Activar ${row.key || "variable"}`}
                  />
                )}
              </td>
              <td>
                <input
                  className="cell mono"
                  value={row?.key ?? ""}
                  readOnly={readOnly}
                  placeholder={row ? undefined : "nombre"}
                  onChange={(e) => update(i, { key: e.target.value })}
                  aria-label={`Variable ${i + 1}`}
                  data-testid={`folder-var-key-${i}`}
                />
              </td>
              <td>
                <input
                  className="cell mono"
                  type={row?.secret && !reveal ? "password" : "text"}
                  autoComplete="off"
                  value={row?.value ?? ""}
                  readOnly={readOnly}
                  placeholder={row ? undefined : "valor"}
                  onChange={(e) => update(i, { value: e.target.value })}
                  aria-label={`Valor ${i + 1}`}
                  data-testid={`folder-var-value-${i}`}
                />
              </td>
              <td>
                {row && (
                  <label className="secret-toggle" title="Solo se oculta en pantalla: el valor sigue en el archivo de la colección, como en Postman">
                    <input
                      type="checkbox"
                      className="check"
                      checked={row.secret}
                      disabled={readOnly}
                      onChange={(e) => update(i, { secret: e.target.checked })}
                      data-testid={`folder-var-secret-${i}`}
                    />
                    <Icon name="lock" size={14} />
                  </label>
                )}
              </td>
              <td>
                {row && !readOnly && (
                  <button
                    type="button"
                    className="icon-btn row-del"
                    title="Quitar variable"
                    aria-label={`Quitar ${row.key || "variable"}`}
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {q && shown.length === 0 && <p className="hint pad">Ninguna variable coincide con «{query.trim()}».</p>}
      {isCollection && (
        <p className="hint pad">
          Úsalas como <span className="mono">{"{{nombre}}"}</span> en cualquier petición de la colección; si el entorno activo tiene una con el mismo nombre, gana la del entorno.
          Las secretas solo se ocultan en pantalla: se guardan en el archivo de la colección, como en Postman. Para que un valor no salga de este equipo, ponlo como secreto en un
          entorno.
        </p>
      )}
    </div>
  );
}

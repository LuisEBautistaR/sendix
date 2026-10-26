import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TreeNode } from "@shared/collection";
import type { CollectionSummary } from "@shared/workspace";
import { emptyRequest, useStore, ws } from "../state/store";
import { Icon } from "../Icon";
import { HistoryList } from "./HistoryList";
import { METHODS, methodClass } from "./RequestPane";

const HTTP_METHODS = new Set<string>(METHODS);

export function Sidebar() {
  const view = useStore((s) => s.sidebar);
  const label = view === "history" ? "Historial" : view === "environments" ? "Entornos" : "Colecciones";
  return (
    <aside className="sidebar" aria-label={label}>
      {view === "history" ? <HistoryList /> : view === "environments" ? <EnvironmentList /> : <CollectionsView />}
    </aside>
  );
}

const fail = (err: unknown) => useStore.getState().notify("err", err instanceof Error ? err.message : String(err));

// ---------- no workspace ----------

function OpenWorkspace() {
  const [recent, setRecent] = useState<Array<{ path: string; name: string }>>([]);
  useEffect(() => {
    void ws("recent", {}).then(setRecent, () => setRecent([]));
  }, []);
  return (
    <div className="empty">
      <p className="empty-title">Abre una carpeta de trabajo</p>
      <p>
        Sendix guarda colecciones y entornos como archivos de Postman v2.1 en una carpeta tuya, lista para git. Puede ser una carpeta vacía o una que ya tenga
        colecciones exportadas.
      </p>
      <button type="button" className="btn btn-primary btn-sm" data-testid="open-workspace" onClick={() => void ws("openFolder", {}).catch(fail)}>
        <Icon name="folder" size={14} /> Abrir carpeta…
      </button>
      {recent.length > 0 && (
        <div className="recent">
          <p className="recent-title">Recientes</p>
          {recent.map((r) => (
            <button key={r.path} type="button" className="recent-row" title={r.path} onClick={() => void ws("openRecent", { path: r.path }).catch(fail)}>
              <span className="recent-name">{r.name}</span>
              <span className="recent-path mono">{r.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- collections ----------

type MenuTarget = { collectionId: string; node: TreeNode | null; x: number; y: number };

function CollectionsView() {
  const workspace = useStore((s) => s.workspace);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [importAt, setImportAt] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const importFile = async () => {
    try {
      const result = await ws("importFile", {});
      if (!result) return;
      const what = result.kind === "environment" ? `entorno con ${result.count} variables` : `${result.count} peticiones`;
      useStore.getState().notify("ok", `Importado «${result.name}»: ${what}.${result.notes.length ? ` ${result.notes.join(" ")}` : ""}`);
      if (result.environmentId) useStore.getState().setSidebar("environments");
    } catch (err) {
      fail(err);
    }
  };
  const importButton = (
    <button
      type="button"
      className="icon-btn"
      title="Importar: colección, entorno, OpenAPI, HAR o un comando cURL"
      aria-label="Importar"
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setImportAt({ x: r.right, y: r.bottom });
      }}
      data-testid="import"
    >
      <Icon name="dl" size={14} />
    </button>
  );
  const importMenu = importAt && <ImportMenu at={importAt} withFiles={Boolean(workspace)} close={() => setImportAt(null)} importFile={() => void importFile()} />;

  if (!workspace) {
    return (
      <>
        <div className="side-head">
          <h2>Colecciones</h2>
          {importButton}
        </div>
        <OpenWorkspace />
        {importMenu}
      </>
    );
  }

  const toggle = (id: string) => setCollapsed((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const createCollection = async () => {
    try {
      const { collectionId } = await ws("createCollection", { name: "Nueva colección" });
      setRenaming(`c:${collectionId}`);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <>
      <div className="side-head">
        <h2>Colecciones</h2>
        {importButton}
        <button type="button" className="icon-btn" title="Nueva colección" aria-label="Nueva colección" onClick={() => void createCollection()} data-testid="new-collection">
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="tree" role="tree" aria-label="Colecciones" data-testid="tree">
        {workspace.collections.length === 0 && (
          <div className="empty">
            <p className="empty-title">La carpeta no tiene colecciones</p>
            <p>Crea una con el botón + o importa una colección de Postman, una definición OpenAPI o una captura HAR.</p>
          </div>
        )}
        {workspace.collections.map((c) => (
          <CollectionRow
            key={c.id}
            collection={c}
            collapsed={collapsed}
            toggle={toggle}
            renaming={renaming}
            setRenaming={setRenaming}
            openMenu={(node, el) => {
              const r = el.getBoundingClientRect();
              setMenu({ collectionId: c.id, node, x: r.right, y: r.bottom });
            }}
          />
        ))}
      </div>
      {workspace.problems.length > 0 && (
        <p className="problems" title={workspace.problems.map((p) => `${p.file}: ${p.reason}`).join("\n")}>
          {workspace.problems.length === 1 ? "1 archivo no se pudo leer" : `${workspace.problems.length} archivos no se pudieron leer`}
        </p>
      )}
      {menu && <ItemMenu target={menu} close={() => setMenu(null)} startRename={setRenaming} />}
      {importMenu}
    </>
  );
}

interface RowProps {
  collection: CollectionSummary;
  collapsed: Set<string>;
  toggle(id: string): void;
  renaming: string | null;
  setRenaming(id: string | null): void;
  openMenu(node: TreeNode | null, el: HTMLElement): void;
}

function CollectionRow({ collection, collapsed, toggle, renaming, setRenaming, openMenu }: RowProps) {
  const key = `c:${collection.id}`;
  const open = !collapsed.has(key);
  return (
    <div role="treeitem" aria-expanded={open} aria-selected={false}>
      <div className="tree-row l0">
        <button type="button" className="tree-main" onClick={() => toggle(key)}>
          <Icon name={open ? "down" : "right"} size={14} />
          <Icon name="box" size={14} />
          {renaming === key ? (
            <RenameInput
              value={collection.name}
              done={(name) => {
                setRenaming(null);
                if (name && name !== collection.name) void ws("renameCollection", { collectionId: collection.id, name }).catch(fail);
              }}
            />
          ) : (
            <span className="name strong">{collection.name}</span>
          )}
        </button>
        <button type="button" className="icon-btn row-menu" title="Más acciones" aria-label={`Acciones de ${collection.name}`} onClick={(e) => openMenu(null, e.currentTarget)}>
          <Icon name="more" size={14} />
        </button>
      </div>
      {open && (
        <div role="group">
          {collection.tree.length === 0 && <p className="tree-empty">Vacía: usa ⋯ para añadir una petición.</p>}
          <Nodes nodes={collection.tree} depth={1} collectionId={collection.id} {...{ collapsed, toggle, renaming, setRenaming, openMenu }} />
        </div>
      )}
    </div>
  );
}

function Nodes({ nodes, depth, collectionId, collapsed, toggle, renaming, setRenaming, openMenu }: Omit<RowProps, "collection"> & { nodes: TreeNode[]; depth: number; collectionId: string }) {
  const activeSource = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return t?.kind === "request" ? t.source : null;
  });
  return (
    <>
      {nodes.map((node) => {
        const open = node.kind === "folder" && !collapsed.has(node.id);
        const selected = node.kind === "request" && activeSource?.itemId === node.id;
        return (
          <div key={node.id} role="treeitem" aria-selected={selected} aria-expanded={node.kind === "folder" ? open : undefined}>
            <div className={`tree-row${selected ? " selected" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} data-testid={node.kind === "request" ? "tree-request" : "tree-folder"}>
              <button
                type="button"
                className="tree-main"
                onClick={() => (node.kind === "folder" ? toggle(node.id) : void useStore.getState().openItem({ collectionId, itemId: node.id }))}
              >
                {node.kind === "folder" ? (
                  <>
                    <Icon name={open ? "down" : "right"} size={14} />
                    <Icon name="folder" size={14} />
                  </>
                ) : (
                  <span className={`meth ${methodClass(node.method ?? "GET")}`}>{node.method === "DELETE" ? "DEL" : node.method}</span>
                )}
                {renaming === node.id ? (
                  <RenameInput
                    value={node.name}
                    done={(name) => {
                      setRenaming(null);
                      if (name && name !== node.name) void ws("renameItem", { collectionId, itemId: node.id, name }).catch(fail);
                    }}
                  />
                ) : (
                  <span className="name">{node.name}</span>
                )}
              </button>
              <button type="button" className="icon-btn row-menu" title="Más acciones" aria-label={`Acciones de ${node.name}`} onClick={(e) => openMenu(node, e.currentTarget)}>
                <Icon name="more" size={14} />
              </button>
            </div>
            {open && node.children && (
              <div role="group">
                {node.children.length === 0 && (
                  <p className="tree-empty" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
                    Carpeta vacía
                  </p>
                )}
                <Nodes nodes={node.children} depth={depth + 1} {...{ collectionId, collapsed, toggle, renaming, setRenaming, openMenu }} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function RenameInput({ value, done }: { value: string; done(name: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={value}
      aria-label="Nuevo nombre"
      data-testid="rename"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(e.currentTarget.value.trim() || null);
        if (e.key === "Escape") done(null);
      }}
      onBlur={(e) => done(e.currentTarget.value.trim() || null)}
    />
  );
}

/** Closes a popup menu on a click outside it or Escape, and focuses its first item. */
function usePopup(ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector("button")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, close]);
}

function ImportMenu({ at, withFiles, close, importFile }: { at: { x: number; y: number }; withFiles: boolean; close(): void; importFile(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePopup(ref, close);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: Math.max(8, at.x - 260), top: at.y + 4 }} data-testid="import-menu">
      {withFiles && (
        <button type="button" role="menuitem" onClick={() => (close(), importFile())} data-testid="import-file">
          Archivo…
          <span className="menu-sub">Colección o entorno de Postman, OpenAPI o HAR</span>
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => (close(), useStore.getState().setCurlImport(true))} data-testid="import-curl">
        Comando cURL…
        <span className="menu-sub">Pégalo de bash, cmd o PowerShell</span>
      </button>
    </div>
  );
}

function ItemMenu({ target, close, startRename }: { target: MenuTarget; close(): void; startRename(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePopup(ref, close);

  const { collectionId, node } = target;
  const parentId = node === null ? null : node.kind === "folder" ? node.id : null;
  const [mockix, setMockix] = useState(false);
  useEffect(() => {
    if (node === null) void window.sendix.mockix.available().then(setMockix);
  }, [node]);
  const run = (fn: () => Promise<unknown>) => () => {
    close();
    void fn().catch(fail);
  };
  const addRequest = run(async () => {
    const { itemId } = await ws("createRequest", { collectionId, parentId, name: "Nueva petición", request: { ...emptyRequest(), auth: { type: "inherit" } }, disabledParams: [] });
    await useStore.getState().openItem({ collectionId, itemId });
    startRename(itemId);
  });
  const addFolder = run(async () => {
    const { itemId } = await ws("createFolder", { collectionId, parentId, name: "Nueva carpeta" });
    startRename(itemId);
  });
  const remove = run(async () => {
    const label = node ? `«${node.name}»${node.kind === "folder" ? " y todo lo que contiene" : ""}` : "la colección completa";
    if (!window.confirm(`¿Eliminar ${label}? Se borrará del archivo en disco.`)) return;
    if (node) await ws("removeItem", { collectionId, itemId: node.id });
    else await ws("deleteCollection", { collectionId });
  });

  // Mockix: only offered when it registered mockix:// on this machine. Mockix asks before importing.
  // Opens the saved request (or the tab that already edits it) and shows its cURL.
  const copyCurl = run(async () => {
    if (!node) return;
    await useStore.getState().openItem({ collectionId, itemId: node.id });
    const { activeId, tabs, openCurl } = useStore.getState();
    if (tabs.find((t) => t.id === activeId)?.kind === "request") openCurl(activeId);
  });

  const createMock = run(async () => {
    const result = await window.sendix.mockix.importCollection(collectionId);
    if (result.ok) useStore.getState().notify("ok", "Se abrió Mockix: confirma allí la importación de la colección.");
    else useStore.getState().notify("err", result.message);
  });

  const items: Array<[string, () => void, boolean?]> = [
    ...(node === null || node.kind === "folder"
      ? ([
          ["Nueva petición", addRequest],
          ["Nueva carpeta", addFolder],
        ] as Array<[string, () => void]>)
      : []),
    ...(node === null || node.kind === "folder"
      ? ([["Ejecutar…", () => (close(), useStore.getState().openRunner(collectionId, node ? node.id : null))]] as Array<[string, () => void]>)
      : []),
    ...(node === null && mockix ? ([["Crear mock desde esta colección", createMock]] as Array<[string, () => void]>) : []),
    ...(node?.kind === "request" && HTTP_METHODS.has(node.method ?? "") ? ([["Copiar como cURL", copyCurl]] as Array<[string, () => void]>) : []),
    ["Renombrar", () => (close(), startRename(node ? node.id : `c:${collectionId}`))],
    ...(node ? ([["Duplicar", run(() => ws("duplicateItem", { collectionId, itemId: node.id }))]] as Array<[string, () => void]>) : []),
    [node ? "Eliminar" : "Eliminar colección", remove, true],
  ];

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: Math.min(target.x - 180, window.innerWidth - 190), top: Math.min(target.y + 4, window.innerHeight - items.length * 30 - 12) }}
      data-testid="item-menu"
    >
      {items.map(([label, action, danger]) => (
        <button key={label} type="button" role="menuitem" className={danger ? "danger" : undefined} onClick={action}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------- environments ----------

function EnvironmentList() {
  const workspace = useStore((s) => s.workspace);
  if (!workspace) {
    return (
      <>
        <div className="side-head">
          <h2>Entornos</h2>
        </div>
        <OpenWorkspace />
      </>
    );
  }
  const create = async () => {
    try {
      const { environmentId } = await ws("createEnvironment", { name: "Nuevo entorno" });
      useStore.getState().openEnvironment(environmentId);
    } catch (err) {
      fail(err);
    }
  };
  const setActive = (environmentId: string | null) =>
    void ws("setActiveEnvironment", { environmentId })
      .then(() => useStore.getState().refreshVariables())
      .catch(fail);

  return (
    <>
      <div className="side-head">
        <h2>Entornos</h2>
        <button type="button" className="icon-btn" title="Nuevo entorno" aria-label="Nuevo entorno" onClick={() => void create()} data-testid="new-environment">
          <Icon name="plus" size={14} />
        </button>
      </div>
      {workspace.environments.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Sin entornos</p>
          <p>Un entorno agrupa variables como {"{{base}}"} o {"{{token}}"} para desarrollo, pruebas o producción. Los valores secretos se guardan cifrados en este equipo, nunca en la carpeta.</p>
        </div>
      ) : (
        <ul className="env-list">
          <li>
            <label className="env-row">
              <input type="radio" name="active-env" checked={workspace.activeEnvironmentId === null} onChange={() => setActive(null)} />
              <span className="name muted">Sin entorno</span>
            </label>
          </li>
          {workspace.environments.map((e) => (
            <li key={e.id}>
              <div className="env-row">
                <input type="radio" name="active-env" aria-label={`Activar ${e.name}`} checked={workspace.activeEnvironmentId === e.id} onChange={() => setActive(e.id)} />
                <button type="button" className="name link" onClick={() => useStore.getState().openEnvironment(e.id)} data-testid="environment-row">
                  {e.name}
                </button>
                {workspace.activeEnvironmentId === e.id && <span className="tag">activo</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

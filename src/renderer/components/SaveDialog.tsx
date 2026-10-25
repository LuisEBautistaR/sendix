import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "@shared/collection";
import { useStore, ws } from "../state/store";
import { requestName } from "../lib/url";

/** Picks where to save a scratch request: name, collection and folder. */
export function SaveDialog() {
  const tabId = useStore((s) => s.savingTabId);
  const workspace = useStore((s) => s.workspace);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.savingTabId));
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [newCollection, setNewCollection] = useState("");

  useEffect(() => {
    if (!tabId || (tab?.kind !== "request" && tab?.kind !== "realtime" && tab?.kind !== "grpc")) return;
    if (tab.kind === "grpc") setName(tab.draft.method || "Nueva llamada gRPC");
    else setName(tab.draft.url.trim() ? requestName(tab.draft.url) : tab.kind === "realtime" ? "Nueva conexión" : "Nueva petición");
    setCollectionId(workspace?.collections[0]?.id ?? "__new");
    setFolderId("");
    setNewCollection("Mi colección");
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(() => {
    const out: Array<{ id: string; label: string }> = [];
    const walk = (nodes: TreeNode[], prefix: string) => {
      for (const n of nodes) {
        if (n.kind !== "folder") continue;
        out.push({ id: n.id, label: `${prefix}${n.name}` });
        walk(n.children ?? [], `${prefix}${n.name} / `);
      }
    };
    walk(workspace?.collections.find((c) => c.id === collectionId)?.tree ?? [], "");
    return out;
  }, [workspace, collectionId]);

  if (!tabId) return null;
  const close = () => {
    dialog.current?.close();
    useStore.getState().closeSaveDialog();
  };
  const submit = async () => {
    let target = collectionId;
    if (target === "__new") {
      try {
        target = (await ws("createCollection", { name: newCollection.trim() || "Mi colección" })).collectionId;
      } catch (err) {
        return useStore.getState().notify("err", (err as Error).message);
      }
    }
    await useStore.getState().saveAs(tabId, target, folderId || null, name.trim() || "Nueva petición");
    if (!useStore.getState().savingTabId) dialog.current?.close();
  };

  return (
    <dialog ref={dialog} className="dialog" onCancel={close} aria-labelledby="save-title" data-testid="save-dialog">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="save-title">{tab?.kind === "realtime" ? "Guardar conexión" : tab?.kind === "grpc" ? "Guardar llamada gRPC" : "Guardar petición"}</h2>
        <label className="field">
          <span>Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="save-name" />
        </label>
        <label className="field">
          <span>Colección</span>
          <select value={collectionId} onChange={(e) => (setCollectionId(e.target.value), setFolderId(""))} data-testid="save-collection">
            {workspace?.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">Nueva colección…</option>
          </select>
        </label>
        {collectionId === "__new" ? (
          <label className="field">
            <span>Nombre de la colección</span>
            <input value={newCollection} onChange={(e) => setNewCollection(e.target.value)} data-testid="save-new-collection" />
          </label>
        ) : (
          <label className="field">
            <span>Carpeta</span>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} data-testid="save-folder">
              <option value="">(raíz de la colección)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm" data-testid="save-confirm">
            Guardar
          </button>
        </div>
      </form>
    </dialog>
  );
}

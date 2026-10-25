import { isDirty, useStore, type Tab } from "../state/store";
import { requestName } from "../lib/url";
import { Icon } from "../Icon";
import { methodClass } from "./RequestPane";

function useLabel(tab: Tab): { method: string | null; name: string; title: string; dirty: boolean } {
  const environments = useStore((s) => s.workspace?.environments);
  const collections = useStore((s) => s.workspace?.collections);
  if (tab.kind === "system") return { method: null, name: "Estado del sistema", title: "Estado del sistema", dirty: false };
  if (tab.kind === "runner") {
    const collection = collections?.find((c) => c.id === tab.collectionId);
    const name = `Ejecutar ${collection?.name ?? "colección"}`;
    return { method: null, name, title: name, dirty: false };
  }
  if (tab.kind === "environment") {
    const name = environments?.find((e) => e.id === tab.environmentId)?.name ?? "Entorno";
    return { method: null, name, title: `Entorno ${name}`, dirty: false };
  }
  if (tab.kind === "grpc") {
    const name = tab.name ?? (tab.draft.method || tab.draft.target.trim() || "Nueva llamada gRPC");
    return { method: "GRPC", name, title: `${name}\ngRPC ${tab.draft.target} ${tab.draft.service}/${tab.draft.method}`, dirty: isDirty(tab) };
  }
  const method = tab.kind === "realtime" ? (tab.draft.protocol === "websocket" ? "WS" : "SIO") : tab.draft.method;
  const name = tab.name ?? (tab.draft.url.trim() ? requestName(tab.draft.url) : tab.kind === "realtime" ? "Nueva conexión" : "Nueva petición");
  const where = tab.path.length ? `${tab.path.join(" / ")} / ` : "";
  return { method, name, title: `${where}${name}\n${method} ${tab.draft.url}`, dirty: isDirty(tab) };
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const { method, name, title, dirty } = useLabel(tab);
  const { activate, close } = useStore.getState();
  const sending = (tab.kind === "request" && tab.status === "sending") || (tab.kind === "runner" && tab.status !== "idle");
  const live = (tab.kind === "realtime" && tab.state === "open") || (tab.kind === "grpc" && tab.state !== "idle");
  return (
    <div className="tab" role="tab" aria-selected={active} data-testid="tab">
      <button type="button" className="tab-main" onClick={() => activate(tab.id)} onAuxClick={(e) => e.button === 1 && close(tab.id)} title={title}>
        {method ? (
          <span className={`meth ${methodClass(method)}`}>{method === "DELETE" ? "DEL" : method}</span>
        ) : (
          <Icon name={tab.kind === "environment" ? "layers" : tab.kind === "runner" ? "run" : "pulse"} size={14} />
        )}
        <span className={`name${(tab.kind === "request" || tab.kind === "realtime" || tab.kind === "grpc") && !tab.source ? " scratch" : ""}`}>{name}</span>
        {sending && <span className="sending-dot" aria-label="Enviando" />}
        {live && <span className="live-dot" aria-label="Conectada" />}
      </button>
      {dirty ? (
        <button type="button" className="x dirty" title="Cambios sin guardar (Ctrl S para guardar). Clic para cerrar." aria-label={`Cerrar ${name}, tiene cambios sin guardar`} onClick={() => close(tab.id)}>
          <span className="unsaved" />
        </button>
      ) : (
        <button type="button" className="x" title="Cerrar pestaña (Ctrl W)" aria-label={`Cerrar ${name}`} onClick={() => close(tab.id)}>
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function TabStrip() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeId);
  return (
    <div className="tabs" role="tablist" aria-label="Pestañas abiertas">
      {tabs.map((tab) => (
        <TabButton key={tab.id} tab={tab} active={tab.id === activeId} />
      ))}
      <button type="button" className="tab-new" title="Nueva petición (Ctrl T)" aria-label="Nueva petición" onClick={() => useStore.getState().newRequest()} data-testid="new-tab">
        <Icon name="plus" />
      </button>
    </div>
  );
}

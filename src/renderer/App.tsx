import { useEffect, useState } from "react";
import type { EngineStatus } from "@shared/ipc";
import { useStore, ws, type SidebarView } from "./state/store";
import { Icon, type IconName } from "./Icon";
import { Sidebar } from "./components/Sidebar";
import { TabStrip } from "./components/TabStrip";
import { RequestEditor, RequestLine } from "./components/RequestPane";
import { ResponsePane } from "./components/ResponsePane";
import { STATE_LABEL, SystemStatus, useEngineStatus } from "./components/SystemStatus";
import { EnvironmentEditor } from "./components/EnvironmentEditor";
import { SaveDialog } from "./components/SaveDialog";
import { Notices, TitleBar } from "./components/TitleBar";
import { RunnerView } from "./components/RunnerView";
import { RealtimeEditor, RealtimeLine, RealtimeLog } from "./components/RealtimePane";
import { GrpcEditor, GrpcLine, GrpcResponse } from "./components/GrpcPane";
import { SettingsView } from "./components/SettingsView";
import { Split } from "./components/Split";

const RAIL: Array<{ view: SidebarView; icon: IconName; label: string }> = [
  { view: "collections", icon: "folder", label: "Colecciones" },
  { view: "environments", icon: "layers", label: "Entornos" },
  { view: "history", icon: "clock", label: "Historial" },
];

const noop = () => {};

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const { tabs, activeId, send, newRequest, close, save, connect, sendMessage, invokeGrpc, sendGrpc, openSettings } = useStore.getState();
      const active = tabs.find((t) => t.id === activeId);
      const key = e.key.toLowerCase();
      if (key === "enter" && active?.kind === "request") {
        e.preventDefault();
        void send(active.id);
      } else if (key === "enter" && active?.kind === "realtime") {
        e.preventDefault();
        void (active.state === "open" ? sendMessage(active.id) : active.state === "idle" ? connect(active.id) : undefined);
      } else if (key === "enter" && active?.kind === "grpc") {
        e.preventDefault();
        const streaming = active.state === "running" && (active.callType === "client" || active.callType === "bidi");
        void (streaming ? sendGrpc(active.id) : active.state === "idle" ? invokeGrpc(active.id) : undefined);
      } else if (key === "s" && (active?.kind === "request" || active?.kind === "realtime" || active?.kind === "grpc")) {
        e.preventDefault();
        void save(active.id);
      } else if (key === "t") {
        e.preventDefault();
        newRequest();
      } else if (key === "w" && active) {
        e.preventDefault();
        close(active.id);
      } else if (key === ",") {
        e.preventDefault();
        openSettings();
      } else if (key === "l") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-testid="url"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function usePrefs() {
  useEffect(() => {
    const { setPrefs } = useStore.getState();
    const off = window.sendix.prefs.onChanged(setPrefs);
    void window.sendix.prefs.get().then((p) => p && setPrefs(p));
    return off;
  }, []);
}

function useWorkspace() {
  useEffect(() => {
    const { setWorkspace, onRunEvent, onRealtimeEvent, onGrpcEvent } = useStore.getState();
    const off = window.sendix.workspace.onChanged(setWorkspace);
    const offRun = window.sendix.runner.onEvent(onRunEvent);
    const offRealtime = window.sendix.realtime.onEvent(onRealtimeEvent);
    const offGrpc = window.sendix.grpc.onEvent(onGrpcEvent);
    void window.sendix.workspace.call("current", {}).then((o) => o.ok && setWorkspace(o.value));
    return () => {
      off();
      offRun();
      offRealtime();
      offGrpc();
    };
  }, []);
}

export function App() {
  useShortcuts();
  usePrefs();
  useWorkspace();
  const sidebar = useStore((s) => s.sidebar);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const workspace = useStore((s) => s.workspace);
  const engine = useEngineStatus(noop);
  const [version, setVersion] = useState("");
  useEffect(() => void window.sendix.app.info().then((i) => i && setVersion(i.version)), []);
  const { setSidebar, openSystem, openSettings } = useStore.getState();

  return (
    <div className="app">
      <TitleBar />

      <nav className="rail" aria-label="Secciones">
        {RAIL.map((item) => (
          <button
            key={item.view}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={sidebar === item.view ? "page" : undefined}
            onClick={() => setSidebar(item.view)}
            data-testid={`rail-${item.view}`}
          >
            <Icon name={item.icon} size={18} />
          </button>
        ))}
        <span className="spacer" />
        <button
          type="button"
          title="Ajustes (Ctrl+,)"
          aria-label="Ajustes"
          aria-current={activeTab?.kind === "settings" ? "page" : undefined}
          onClick={openSettings}
          data-testid="rail-settings"
        >
          <Icon name="sliders" size={18} />
        </button>
        <button
          type="button"
          title="Estado del sistema"
          aria-label="Estado del sistema"
          aria-current={activeTab?.kind === "system" ? "page" : undefined}
          onClick={openSystem}
          data-testid="rail-system"
        >
          <Icon name="pulse" size={18} />
        </button>
      </nav>

      <Sidebar />

      <main className="main">
        <TabStrip />
        {activeTab?.kind === "request" && (
          <section className="screen" key={activeTab.id}>
            {activeTab.source && (
              <div className="breadcrumb" data-testid="breadcrumb">
                {workspace?.collections.find((c) => c.id === activeTab.source?.collectionId)?.name}
                {activeTab.path.map((p, i) => (
                  <span key={i}> / {p}</span>
                ))}
                <span> / </span>
                <b>{activeTab.name}</b>
              </div>
            )}
            <RequestLine tab={activeTab} />
            <Split left={<RequestEditor tab={activeTab} />} right={<ResponsePane tab={activeTab} />} />
          </section>
        )}
        {activeTab?.kind === "environment" && <EnvironmentEditor key={activeTab.id} tab={activeTab} />}
        {activeTab?.kind === "system" && <SystemStatus />}
        {activeTab?.kind === "settings" && <SettingsView />}
        {activeTab?.kind === "runner" && <RunnerView key={activeTab.id} tab={activeTab} />}
        {activeTab?.kind === "grpc" && (
          <section className="screen" key={activeTab.id}>
            {activeTab.source && (
              <div className="breadcrumb" data-testid="breadcrumb">
                {workspace?.collections.find((c) => c.id === activeTab.source?.collectionId)?.name}
                {activeTab.path.map((p, i) => (
                  <span key={i}> / {p}</span>
                ))}
                <span> / </span>
                <b>{activeTab.name}</b>
              </div>
            )}
            <GrpcLine tab={activeTab} />
            <Split left={<GrpcEditor tab={activeTab} />} right={<GrpcResponse tab={activeTab} />} />
          </section>
        )}
        {activeTab?.kind === "realtime" && (
          <section className="screen" key={activeTab.id}>
            {activeTab.source && (
              <div className="breadcrumb" data-testid="breadcrumb">
                {workspace?.collections.find((c) => c.id === activeTab.source?.collectionId)?.name}
                {activeTab.path.map((p, i) => (
                  <span key={i}> / {p}</span>
                ))}
                <span> / </span>
                <b>{activeTab.name}</b>
              </div>
            )}
            <RealtimeLine tab={activeTab} />
            <Split left={<RealtimeEditor tab={activeTab} />} right={<RealtimeLog tab={activeTab} />} />
          </section>
        )}
      </main>

      <StatusBar engine={engine} version={version} />
      <SaveDialog />
      <Notices />
    </div>
  );
}

function StatusBar({ engine, version }: { engine: EngineStatus | null; version: string }) {
  const state = engine?.state ?? "starting";
  const workspace = useStore((s) => s.workspace);
  return (
    <footer className="statusbar">
      <button type="button" className={`engine-dot state-${state}`} onClick={() => useStore.getState().openSystem()} title="Abrir el estado del sistema">
        Motor {STATE_LABEL[state].toLowerCase()}
      </button>
      <span className="mono path" title={workspace?.path}>
        {workspace ? workspace.path : "Sin carpeta de trabajo"}
      </span>
      {workspace?.sessionValues && (
        <span className="session-vars" data-testid="session-vars" title="Valores guardados por scripts con pm.environment.set o pm.collectionVariables.set. Duran hasta cerrar Sendix y no se escriben en los archivos.">
          Variables de sesión activas
          <button
            type="button"
            className="link-btn"
            onClick={() => void ws("clearSession", {}).catch((err: Error) => useStore.getState().notify("err", err.message))}
            data-testid="session-clear"
          >
            Olvidar
          </button>
        </span>
      )}
      <span className="end">{version ? `Sendix ${version}` : ""}</span>
    </footer>
  );
}

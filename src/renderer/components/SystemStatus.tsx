import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppInfo, EngineState, EngineStatus, UpdateState } from "@shared/ipc";
import type { MethodResult } from "@shared/methods";
import { Icon } from "../Icon";
import { runSecurityChecks } from "../security-checks";

export const STATE_LABEL: Record<EngineState, string> = {
  starting: "Iniciando",
  ready: "Listo",
  restarting: "Reiniciando",
  failed: "Detenido por errores",
  stopped: "Detenido",
};

interface PingRow {
  at: number;
  latencyMs: number | null;
  pid: number | null;
  error: string | null;
}

interface LogEntry {
  at: number;
  kind: "estado" | "prueba" | "app";
  text: string;
  tone: "ok" | "err" | "neutral";
}

function describeStatus(s: EngineStatus): Omit<LogEntry, "at"> {
  switch (s.state) {
    case "ready":
      return { kind: "estado", text: `Motor listo (proceso ${s.pid})`, tone: "ok" };
    case "restarting":
      return {
        kind: "estado",
        text: `Motor caído${s.lastExit ? ` con código ${s.lastExit.code}` : ""}; reinicio ${s.restarts}`,
        tone: "err",
      };
    case "failed":
      return { kind: "estado", text: "Motor detenido: demasiados fallos seguidos", tone: "err" };
    default:
      return { kind: "estado", text: `Motor ${STATE_LABEL[s.state].toLowerCase()}`, tone: "neutral" };
  }
}

export function useEngineStatus(onChange: (s: EngineStatus) => void): EngineStatus | null {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    let heard = false;
    const off = window.sendix.engine.onStatus((s) => {
      heard = true;
      setStatus(s);
      onChange(s);
    });
    // The engine may already be ready before the page subscribed.
    void window.sendix.engine.status().then((s) => {
      if (!s || heard) return;
      setStatus(s);
      onChange(s);
    });
    return off;
  }, [onChange]);
  return status;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

const time = (epoch: number) => new Date(epoch).toLocaleTimeString("es-MX", { hour12: false });

function describeUpdate(u: UpdateState): string {
  switch (u.status) {
    case "disabled":
      return "Solo en la versión instalada";
    case "idle":
      return "Sin consultar todavía";
    case "checking":
      return "Buscando…";
    case "current":
      return `Al día${u.checkedAt ? ` (revisado a las ${time(u.checkedAt)})` : ""}`;
    case "downloading":
      return `Descargando ${u.version ?? ""} · ${u.percent ?? 0} %`;
    case "ready":
      return `${u.version} lista para instalar`;
    case "error":
      return u.message ?? "No se pudo consultar";
  }
}

function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const off = window.sendix.app.onUpdates(setState);
    void window.sendix.app.updates().then((s) => s && setState((cur) => cur ?? s));
    return off;
  }, []);
  return state;
}

export function SystemStatus() {
  const [log, setLog] = useState<LogEntry[]>(() => [{ at: Date.now(), kind: "app", text: "Ventana cargada desde app://sendix", tone: "neutral" }]);
  const addLog = useCallback((entry: Omit<LogEntry, "at">) => setLog((rows) => [{ at: Date.now(), ...entry }, ...rows].slice(0, 50)), []);
  const onStatus = useCallback((s: EngineStatus) => addLog(describeStatus(s)), [addLog]);
  const status = useEngineStatus(onStatus);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [engineInfo, setEngineInfo] = useState<MethodResult<"system.info"> | null>(null);
  const [pings, setPings] = useState<PingRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const checks = useMemo(runSecurityChecks, []);
  const update = useUpdates();

  useEffect(() => {
    void window.sendix.app.info().then(setInfo);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const ping = useCallback(async () => {
    setBusy(true);
    const sentAt = Date.now();
    const outcome = await window.sendix.engine.call("system.ping", { sentAt });
    const row: PingRow = outcome.ok
      ? { at: sentAt, latencyMs: Date.now() - sentAt, pid: outcome.value.pid, error: null }
      : { at: sentAt, latencyMs: null, pid: null, error: `${outcome.error.code}: ${outcome.error.message}` };
    setPings((rows) => [row, ...rows].slice(0, 8));
    addLog(
      row.error
        ? { kind: "prueba", text: `Prueba fallida: ${row.error}`, tone: "err" }
        : { kind: "prueba", text: `Respuesta del proceso ${row.pid} en ${row.latencyMs} ms`, tone: "ok" },
    );
    setBusy(false);
  }, [addLog]);

  // Each time an engine process becomes ready: describe it and check the round trip.
  useEffect(() => {
    if (status?.state !== "ready") return;
    void window.sendix.engine.call("system.info", {}).then((o) => o.ok && setEngineInfo(o.value));
    void ping();
  }, [status?.state, status?.pid, ping]);

  const state = status?.state ?? "starting";
  const last = pings[0];

  return (
    <div className="system" data-testid="system-status">
        <div className="page-head">
          <h1>Estado del sistema</h1>
          <span className="page-sub">Motor, aislamiento de la interfaz y versiones de esta instalación</span>
        </div>

        <div className="grid">
          <section className="panel" aria-labelledby="engine-h" data-testid="engine-panel">
            <div className="panel-head">
              <h2 id="engine-h">Motor</h2>
              <span className={`state state-${state}`} data-testid="engine-state">
                {STATE_LABEL[state]}
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={ping} disabled={busy || state !== "ready"} data-testid="ping">
                Probar motor
              </button>
            </div>
            <dl className="facts">
              <dt>Proceso</dt>
              <dd className="mono" data-testid="engine-pid">{status?.pid ?? "—"}</dd>
              <dt>Activo desde hace</dt>
              <dd className="mono">{status?.readySince ? formatUptime(now - status.readySince) : "—"}</dd>
              <dt>Reinicios</dt>
              <dd className="mono" data-testid="engine-restarts">{status?.restarts ?? 0}</dd>
              <dt>Última respuesta</dt>
              <dd className="mono" data-testid="ping-latency">
                {last?.latencyMs != null ? `${last.latencyMs} ms` : last?.error ? "error" : "—"}
              </dd>
              <dt>Proveedores</dt>
              <dd className="mono">{engineInfo?.providers.join(", ") ?? "—"}</dd>
            </dl>
            <table className="kv">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Resultado</th>
                  <th>Latencia</th>
                  <th>Proceso</th>
                </tr>
              </thead>
              <tbody>
                {pings.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">Aún no hay pruebas: el motor se prueba solo al arrancar.</td>
                  </tr>
                )}
                {pings.map((row) => (
                  <tr key={row.at}>
                    <td className="mono">{time(row.at)}</td>
                    <td>{row.error ? <span className="st err">{row.error}</span> : <span className="st ok">pong</span>}</td>
                    <td className="mono">{row.latencyMs != null ? `${row.latencyMs} ms` : "—"}</td>
                    <td className="mono">{row.pid ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel" aria-labelledby="sec-h" data-testid="security-panel">
            <div className="panel-head">
              <h2 id="sec-h">Aislamiento de la interfaz</h2>
              <span className="count">
                {checks.filter((c) => c.passed).length}/{checks.length}
              </span>
            </div>
            <ul className="checks">
              {checks.map((check) => (
                <li key={check.id} data-testid={`check-${check.id}`} data-passed={check.passed}>
                  <span className={check.passed ? "ok" : "err"}>
                    <Icon name={check.passed ? "check" : "x"} size={14} />
                  </span>
                  <span className="check-label">{check.label}</span>
                  <span className={`check-result ${check.passed ? "ok" : "err"}`}>{check.passed ? "CORRECTO" : "FALLA"}</span>
                  <span className="check-detail">{check.detail}</span>
                </li>
              ))}
            </ul>

            <div className="panel-head sub">
              <h2>Versiones</h2>
            </div>
            <dl className="facts">
              <dt>Sendix</dt>
              <dd className="mono">{info ? `${info.version}${info.packaged ? "" : " (desarrollo)"}` : "—"}</dd>
              <dt>Electron</dt>
              <dd className="mono">{info?.electron ?? "—"}</dd>
              <dt>Chromium</dt>
              <dd className="mono">{info?.chrome ?? "—"}</dd>
              <dt>Node.js (principal)</dt>
              <dd className="mono">{info?.node ?? "—"}</dd>
              <dt>Node.js (motor)</dt>
              <dd className="mono">{engineInfo?.node ?? "—"}</dd>
              <dt>Sistema</dt>
              <dd className="mono">{info ? `${info.platform} ${info.arch}` : "—"}</dd>
              <dt>Actualizaciones</dt>
              <dd className="update-row">
                <span data-testid="update-status">{update ? describeUpdate(update) : "—"}</span>
                {update?.status === "ready" ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void window.sendix.app.installUpdate()} data-testid="update-install">
                    Reiniciar para actualizar
                  </button>
                ) : (
                  update &&
                  update.status !== "disabled" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void window.sendix.app.checkUpdates()}
                      disabled={update.status === "checking" || update.status === "downloading"}
                      data-testid="update-check"
                    >
                      Buscar
                    </button>
                  )
                )}
              </dd>
            </dl>
          </section>
        </div>

        <section className="panel events" aria-labelledby="log-h" data-testid="event-log">
          <div className="panel-head">
            <h2 id="log-h">Eventos</h2>
            <span className="count">{log.length}</span>
          </div>
          <ul className="log">
            {log.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span className="mono log-time">{time(entry.at)}</span>
                <span className="log-kind">{entry.kind}</span>
                <span className={`log-text tone-${entry.tone}`}>{entry.text}</span>
              </li>
            ))}
          </ul>
        </section>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "@shared/ipc";
import { useStore } from "../state/store";
import { clockTime, dayLabel, formatMs } from "../lib/format";
import { Icon } from "../Icon";

function useHistory(): HistoryEntry[] {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    void window.sendix.history.list().then((list) => list && setEntries(list));
    return window.sendix.history.onChanged((entry) => {
      if (entry === null) setEntries([]);
      else setEntries((list) => [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, 200));
    });
  }, []);
  return entries;
}

function urlParts(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: `${u.pathname}${u.search}` };
  } catch {
    return { host: "", path: url };
  }
}

export function HistoryList() {
  const entries = useHistory();
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = q ? entries.filter((e) => `${e.method} ${e.url} ${e.status ?? e.error ?? ""}`.toLowerCase().includes(q)) : entries;
    const map = new Map<string, HistoryEntry[]>();
    for (const e of shown) {
      const label = dayLabel(e.at);
      map.set(label, [...(map.get(label) ?? []), e]);
    }
    return [...map.entries()];
  }, [entries, filter]);

  return (
    <>
      <div className="side-head">
        <h2>Historial</h2>
        {entries.length > 0 &&
          (confirming ? (
            <button
              type="button"
              className="link-btn danger"
              data-testid="history-clear-confirm"
              onClick={() => {
                void window.sendix.history.clear();
                setConfirming(false);
              }}
            >
              Confirmar borrado
            </button>
          ) : (
            <button type="button" className="icon-btn" title="Borrar historial" aria-label="Borrar historial" onClick={() => setConfirming(true)} data-testid="history-clear">
              <Icon name="trash" size={14} />
            </button>
          ))}
      </div>
      <label className="filter">
        <Icon name="search" size={14} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por URL, método o estado" aria-label="Filtrar historial" />
      </label>
      {entries.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Sin peticiones todavía</p>
          <p>Cada petición que envíes aparecerá aquí con su estado y su tiempo. Los tokens y contraseñas nunca se guardan.</p>
        </div>
      ) : (
        <div className="history" data-testid="history">
          {groups.length === 0 && <p className="hint pad">Nada coincide con el filtro.</p>}
          {groups.map(([day, list]) => (
            <section key={day}>
              <h3 className="day">{day}</h3>
              <ul>
                {list.map((e) => {
                  const { host, path } = urlParts(e.url);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="hist-row"
                        title={`${e.method} ${e.url}\n${clockTime(e.at)}${e.durationMs != null ? ` · ${formatMs(e.durationMs)}` : ""}`}
                        onClick={() => useStore.getState().newRequest(e.request, { redactedFromHistory: e.redacted })}
                        data-testid="history-entry"
                      >
                        <span className={`meth m-${e.method.toLowerCase()}`}>{e.method === "DELETE" ? "DEL" : e.method}</span>
                        <span className="hist-url">
                          <span className="hist-path">{path || "/"}</span>
                          <span className="hist-host">{host}</span>
                        </span>
                        <span className={`hist-status ${e.status == null ? "err" : e.status >= 400 ? "err" : e.status < 300 ? "ok" : ""}`}>
                          {e.status ?? (e.error === "CANCELLED" ? "—" : "ERR")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

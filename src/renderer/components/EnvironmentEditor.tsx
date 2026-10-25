import { useEffect, useState } from "react";
import type { EnvironmentRowInput } from "@shared/workspace";
import { useStore, ws, type EnvironmentTab } from "../state/store";
import { Icon } from "../Icon";

interface Row extends EnvironmentRowInput {
  /** Secret rows that already have a stored value. */
  stored: boolean;
}

/** Editor for one environment. Secret values are write-only: shown as stored, replaced only when retyped. */
export function EnvironmentEditor({ tab }: { tab: EnvironmentTab }) {
  const workspace = useStore((s) => s.workspace);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState("");
  const [busy, setBusy] = useState(false);
  const active = workspace?.activeEnvironmentId === tab.environmentId;

  useEffect(() => {
    void ws("getEnvironment", { environmentId: tab.environmentId }).then(
      (view) => {
        const next = view.rows.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled, secret: r.secret, keepSecret: r.secret && r.hasValue, stored: r.secret && r.hasValue }));
        setName(view.name);
        setRows(next);
        setLoaded(JSON.stringify([view.name, next]));
      },
      (err: Error) => useStore.getState().notify("err", err.message),
    );
  }, [tab.environmentId]);

  const dirty = loaded !== "" && loaded !== JSON.stringify([name, rows]);
  const update = (i: number, patch: Partial<Row>) => setRows((list) => (i === list.length ? [...list, { key: "", value: "", enabled: true, secret: false, keepSecret: false, stored: false, ...patch }] : list.map((r, j) => (j === i ? { ...r, ...patch } : r))));

  const save = async () => {
    setBusy(true);
    try {
      await ws("saveEnvironment", { environmentId: tab.environmentId, name: name.trim() || "Entorno", rows: rows.map(({ stored: _s, ...r }) => r) });
      const view = await ws("getEnvironment", { environmentId: tab.environmentId });
      const next = view.rows.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled, secret: r.secret, keepSecret: r.secret && r.hasValue, stored: r.secret && r.hasValue }));
      setRows(next);
      setLoaded(JSON.stringify([view.name, next]));
      useStore.getState().notify("ok", "Entorno guardado.");
      void useStore.getState().refreshVariables();
    } catch (err) {
      useStore.getState().notify("err", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section className="screen env-editor" data-testid="environment-editor">
      <div className="reqline">
        <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del entorno" data-testid="environment-name" />
        <label className="switch inline-switch">
          <input
            type="checkbox"
            className="check"
            checked={active}
            onChange={(e) =>
              void ws("setActiveEnvironment", { environmentId: e.target.checked ? tab.environmentId : null })
                .then(() => useStore.getState().refreshVariables())
                .catch((err: Error) => useStore.getState().notify("err", err.message))
            }
          />
          <span>Entorno activo</span>
        </label>
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()} data-testid="environment-save">
          <Icon name="save" size={14} /> Guardar <kbd>Ctrl S</kbd>
        </button>
      </div>
      <div className="pane-body">
        <table className="kv editable env-table" data-testid="environment-table">
          <colgroup>
            <col style={{ width: 34 }} />
            <col style={{ width: "30%" }} />
            <col />
            <col style={{ width: 96 }} />
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
            {[...rows, null].map((row, i) => (
              <tr key={i} className={row && !row.enabled ? "off" : undefined}>
                <td className="ck">{row && <input type="checkbox" className="check" checked={row.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} aria-label={`Activar ${row.key || "variable"}`} />}</td>
                <td>
                  <input className="cell mono" value={row?.key ?? ""} placeholder={row ? undefined : "nombre"} onChange={(e) => update(i, { key: e.target.value })} aria-label={`Variable ${i + 1}`} data-testid={`env-key-${i}`} />
                </td>
                <td>
                  {row?.secret ? (
                    <input
                      className="cell mono"
                      type="password"
                      autoComplete="off"
                      value={row.keepSecret ? "" : row.value}
                      placeholder={row.keepSecret ? "•••••••• guardado; escribe para reemplazarlo" : "valor secreto"}
                      onChange={(e) => update(i, { value: e.target.value, keepSecret: false })}
                      aria-label={`Valor secreto ${i + 1}`}
                      data-testid={`env-value-${i}`}
                    />
                  ) : (
                    <input className="cell mono" value={row?.value ?? ""} placeholder={row ? undefined : "valor"} onChange={(e) => update(i, { value: e.target.value })} aria-label={`Valor ${i + 1}`} data-testid={`env-value-${i}`} />
                  )}
                </td>
                <td>
                  {row && (
                    <label className="secret-toggle" title="Las variables secretas se guardan cifradas en este equipo, nunca en la carpeta">
                      <input
                        type="checkbox"
                        className="check"
                        checked={row.secret}
                        onChange={(e) => update(i, e.target.checked ? { secret: true, keepSecret: false } : { secret: false, keepSecret: false, value: row.stored ? "" : row.value })}
                        data-testid={`env-secret-${i}`}
                      />
                      <Icon name="lock" size={14} />
                    </label>
                  )}
                </td>
                <td>
                  {row && (
                    <button type="button" className="icon-btn row-del" title="Quitar variable" aria-label={`Quitar ${row.key || "variable"}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint pad">
          Usa las variables como <span className="mono">{"{{nombre}}"}</span> en la URL, las cabeceras o el cuerpo. Las marcadas como secretas se cifran con el sistema
          operativo y no se escriben en el archivo del entorno, así que la carpeta se puede compartir o subir a git sin exponerlas.
        </p>
        {active ? null : <p className="hint pad">Este entorno no está activo: actívalo para que sus valores se usen al enviar.</p>}
      </div>
    </section>
  );
}

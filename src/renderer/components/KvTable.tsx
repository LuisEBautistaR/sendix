import type { KeyValue } from "@shared/http";
import { Icon } from "../Icon";

interface Props {
  rows: KeyValue[];
  onChange(rows: KeyValue[]): void;
  keyLabel?: string;
  valueLabel?: string;
  /** Prefix for test ids and accessible names. */
  name: string;
}

/** Editable key/value table. The last, empty row turns into a real row as soon as something is typed. */
export function KvTable({ rows, onChange, keyLabel = "Clave", valueLabel = "Valor", name }: Props) {
  const update = (index: number, patch: Partial<KeyValue>) => {
    if (index === rows.length) {
      onChange([...rows, { key: "", value: "", enabled: true, ...patch }]);
      return;
    }
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const all = [...rows, null];

  return (
    <table className="kv editable" data-testid={`${name}-table`}>
      <colgroup>
        <col style={{ width: 34 }} />
        <col style={{ width: "32%" }} />
        <col style={{ width: "32%" }} />
        <col />
        <col style={{ width: 34 }} />
      </colgroup>
      <thead>
        <tr>
          <th />
          <th>{keyLabel}</th>
          <th>{valueLabel}</th>
          <th>Descripción</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {all.map((row, i) => (
          <tr key={i} className={row && !row.enabled ? "off" : undefined}>
            <td className="ck">
              {row && (
                <input
                  type="checkbox"
                  className="check"
                  checked={row.enabled}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                  aria-label={`Activar ${row.key || "fila"}`}
                />
              )}
            </td>
            <td>
              <input
                className="cell mono"
                value={row?.key ?? ""}
                placeholder={row ? undefined : keyLabel}
                aria-label={`${keyLabel} ${i + 1}`}
                data-testid={`${name}-key-${i}`}
                onChange={(e) => update(i, { key: e.target.value })}
              />
            </td>
            <td>
              <input
                className="cell mono"
                value={row?.value ?? ""}
                placeholder={row ? undefined : valueLabel}
                aria-label={`${valueLabel} ${i + 1}`}
                data-testid={`${name}-value-${i}`}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </td>
            <td>
              <input
                className="cell"
                value={row?.description ?? ""}
                placeholder={row ? undefined : "Descripción"}
                aria-label={`Descripción ${i + 1}`}
                onChange={(e) => update(i, { description: e.target.value })}
              />
            </td>
            <td>
              {row && (
                <button type="button" className="icon-btn row-del" title="Quitar fila" aria-label={`Quitar ${row.key || "fila"}`} onClick={() => remove(i)}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

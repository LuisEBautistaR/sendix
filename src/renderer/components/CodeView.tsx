import { useMemo } from "react";
import { tokenizeJsonLine } from "../lib/highlight";

const MAX_LINES = 20_000;

/** Read-only code with line numbers. JSON gets colour; anything else is shown as typed. */
export function CodeView({ text, json, wrap = false, testId }: { text: string; json: boolean; wrap?: boolean; testId?: string }) {
  const { lines, hidden } = useMemo(() => {
    const all = text.split(/\r?\n/);
    return { lines: all.slice(0, MAX_LINES), hidden: Math.max(0, all.length - MAX_LINES) };
  }, [text]);

  return (
    <div className="codeview" data-testid={testId}>
      <pre className={`code${wrap ? " wrap" : ""}`}>
        {lines.map((line, i) => (
          <span className="ln" key={i}>
            {json ? tokenizeJsonLine(line).map((t, j) => (t.kind === "plain" ? t.text : <span key={j} className={`t-${t.kind}`}>{t.text}</span>)) : line}
            {line === "" ? " " : null}
          </span>
        ))}
      </pre>
      {hidden > 0 && <p className="code-note">{hidden.toLocaleString("es-MX")} líneas más sin mostrar. Usa la vista Cruda o copia la respuesta.</p>}
    </div>
  );
}

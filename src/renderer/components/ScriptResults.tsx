import type { ConsoleEntry, ScriptReport, TestResult } from "@shared/http";
import { Icon } from "../Icon";

export function testSummary(tests: readonly TestResult[]) {
  const passed = tests.filter((t) => t.passed && !t.skipped).length;
  const skipped = tests.filter((t) => t.skipped).length;
  return { passed, failed: tests.length - passed - skipped, skipped, total: tests.length };
}

const PHASE: Record<ScriptReport["errors"][number]["phase"], string> = { prerequest: "antes de la petición", test: "después de la respuesta" };

export function ScriptErrors({ errors }: { errors: ScriptReport["errors"] }) {
  if (!errors.length) return null;
  return (
    <div className="script-errors" data-testid="script-errors">
      {errors.map((e, i) => (
        <p key={i} className="notice warn">
          <Icon name="x" size={14} />
          <span>
            Error en el script {PHASE[e.phase]}: <span className="mono">{e.message}</span>
          </span>
        </p>
      ))}
    </div>
  );
}

export function TestList({ report }: { report: ScriptReport | undefined }) {
  const tests = report?.tests ?? [];
  const errors = report?.errors ?? [];
  if (!tests.length && !errors.length) {
    return <p className="hint pad">Esta petición no tiene tests. Escríbelos en Scripts → Después de la respuesta con <span className="mono">pm.test</span>.</p>;
  }
  const s = testSummary(tests);
  return (
    <div className="pane-body" data-testid="test-results">
      <ScriptErrors errors={errors} />
      {tests.length > 0 && (
        <>
          <div className="test-summary">
            <span className="ok">{s.passed} pasaron</span>
            {s.failed > 0 && <span className="err">{s.failed} fallaron</span>}
            {s.skipped > 0 && <span className="muted">{s.skipped} omitidos</span>}
          </div>
          <ul className="tests">
            {tests.map((t, i) => (
              <li key={i} className={t.skipped ? "skip" : t.passed ? "pass" : "fail"} data-testid="test-row">
                <span className="badge">{t.skipped ? "OMITIDO" : t.passed ? "PASA" : "FALLA"}</span>
                <span className="name">{t.name || "(sin nombre)"}</span>
                {t.error && <span className="why mono">{t.error}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ConsoleList({ entries }: { entries: readonly ConsoleEntry[] }) {
  if (!entries.length) return <p className="hint pad">Los scripts no escribieron nada en la consola.</p>;
  return (
    <div className="pane-body">
      <ol className="console" data-testid="console">
        {entries.map((e, i) => (
          <li key={i} className={`lvl-${e.level}`}>
            <span className="lvl">{e.level}</span>
            <span className="mono text">{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

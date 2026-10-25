/**
 * Collects what pre-request and test scripts do during a postman-runtime run:
 * test results, console output, uncaught errors and variable changes. Every
 * string that leaves the engine has the active secrets masked.
 */
import { inspect } from "node:util";
import type { ConsoleEntry, ScriptReport, SessionChanges, TestResult } from "@shared/http";

const MAX_CONSOLE = 500;
const MAX_TEXT = 10_000;
const LEVELS = new Set<ConsoleEntry["level"]>(["log", "info", "warn", "error", "debug"]);
const MASK = "••••••••";

export class ScriptCollector {
  readonly #secrets: string[];
  #phase: "prerequest" | "test" = "prerequest";
  readonly tests: TestResult[] = [];
  readonly console: ConsoleEntry[] = [];
  readonly errors: ScriptReport["errors"] = [];

  /** Secret values shorter than 4 characters are not masked: they would hide ordinary text. */
  constructor(secrets: readonly string[]) {
    this.#secrets = secrets.filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
  }

  mask(text: string): string {
    let out = text;
    for (const s of this.#secrets) out = out.split(s).join(MASK);
    return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}…` : out;
  }

  #format(value: unknown): string {
    return typeof value === "string" ? value : inspect(value, { depth: 4, breakLength: Infinity, maxArrayLength: 50, maxStringLength: 2_000 });
  }

  /** Runtime callbacks to spread into run.start(). */
  callbacks() {
    return {
      beforePrerequest: () => {
        this.#phase = "prerequest";
      },
      beforeTest: () => {
        this.#phase = "test";
      },
      console: (_cursor: unknown, level: string, ...messages: unknown[]) => {
        if (this.console.length >= MAX_CONSOLE) return;
        const lvl = LEVELS.has(level as ConsoleEntry["level"]) ? (level as ConsoleEntry["level"]) : "log";
        this.console.push({ level: lvl, text: this.mask(messages.map((m) => this.#format(m)).join(" ")) });
      },
      assertion: (_cursor: unknown, assertions: Array<{ name?: string; passed?: boolean; skipped?: boolean; error?: { message?: string } | null }>) => {
        for (const a of assertions ?? []) {
          this.tests.push({
            name: this.mask(String(a.name ?? "")),
            passed: a.passed === true,
            skipped: a.skipped === true,
            error: a.error ? this.mask(String(a.error.message ?? a.error)) : null,
          });
        }
      },
      exception: (_cursor: unknown, err: { message?: string } | null) => {
        this.errors.push({ phase: this.#phase, message: this.mask(String(err?.message ?? err ?? "Error en el script")) });
      },
    };
  }

  report(): ScriptReport {
    return { tests: this.tests, console: this.console, errors: this.errors };
  }
}

type Scope = { values?: { all?(): Array<{ key: string; value: unknown; disabled?: boolean }> } } | undefined;

export function snapshot(scope: Scope): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of scope?.values?.all?.() ?? []) if (!v.disabled) map.set(v.key, v.value == null ? "" : String(v.value));
  return map;
}

export function diff(before: Map<string, string>, after: Map<string, string>): SessionChanges["environment"] {
  const changes: SessionChanges["environment"] = [];
  for (const [key, value] of after) if (before.get(key) !== value) changes.push({ key, value });
  for (const key of before.keys()) if (!after.has(key)) changes.push({ key, value: null });
  return changes;
}

export const hasScripts = (report: ScriptReport) => report.tests.length > 0 || report.console.length > 0 || report.errors.length > 0;

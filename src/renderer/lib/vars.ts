import type { VariableView } from "@shared/workspace";

export interface Segment {
  text: string;
  /** Set when the segment is a {{variable}} reference. */
  variable?: { key: string; defined: boolean; secret: boolean; value: string | null };
}

const VAR = /\{\{([^{}]+)\}\}/g;

/** Splits text into plain parts and {{variable}} references, marking which are defined. */
export function segments(text: string, vars: readonly VariableView[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const key = m[1]!.trim();
    const found = vars.find((v) => v.key === key);
    out.push({ text: m[0], variable: { key, defined: Boolean(found), secret: found?.secret ?? false, value: found?.value ?? null } });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Replaces known variables for previews; secrets show as dots and unknown ones stay as typed. */
export function resolvePreview(text: string, vars: readonly VariableView[]): string {
  return text.replace(VAR, (whole, raw: string) => {
    const found = vars.find((v) => v.key === raw.trim());
    if (!found) return whole;
    return found.secret ? "••••••••" : (found.value ?? "");
  });
}

export function undefinedVariables(texts: readonly string[], vars: readonly VariableView[]): string[] {
  const missing = new Set<string>();
  for (const t of texts) for (const s of segments(t, vars)) if (s.variable && !s.variable.defined) missing.add(s.variable.key);
  return [...missing];
}

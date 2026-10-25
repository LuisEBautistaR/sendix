/** Minimal tokenizer for JSON-like text, rendered as React spans (never as HTML). */
export type TokenKind = "key" | "str" | "num" | "lit" | "punct" | "plain";
export interface Token {
  kind: TokenKind;
  text: string;
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|([{}[\],])/g;

export function tokenizeJsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(JSON_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) tokens.push({ kind: "plain", text: line.slice(last, at) });
    const [whole, str, colon, num, lit, punct] = m;
    if (str !== undefined) {
      if (colon !== undefined) {
        tokens.push({ kind: "key", text: str }, { kind: "punct", text: colon });
      } else tokens.push({ kind: "str", text: str });
    } else if (num !== undefined) tokens.push({ kind: "num", text: num });
    else if (lit !== undefined) tokens.push({ kind: "lit", text: lit });
    else if (punct !== undefined) tokens.push({ kind: "punct", text: punct });
    last = at + whole.length;
  }
  if (last < line.length) tokens.push({ kind: "plain", text: line.slice(last) });
  return tokens;
}

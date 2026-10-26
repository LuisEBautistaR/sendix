/** Response filters: XPath for XML (the browser's own evaluator); JSONPath lives in filter-json.ts. */
import type { FilterResult } from "./filter-json";

export { filterJson, type FilterResult } from "./filter-json";

export function filterXml(text: string, expression: string): FilterResult {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return { ok: false, error: "La respuesta no es XML válido." };
  let result: XPathResult;
  try {
    result = doc.evaluate(expression, doc, doc.createNSResolver(doc.documentElement), XPathResult.ANY_TYPE, null);
  } catch (err) {
    return { ok: false, error: `Expresión XPath no válida: ${(err as Error).message}` };
  }
  switch (result.resultType) {
    case XPathResult.NUMBER_TYPE:
      return { ok: true, text: String(result.numberValue), count: 1 };
    case XPathResult.STRING_TYPE:
      return { ok: true, text: result.stringValue, count: 1 };
    case XPathResult.BOOLEAN_TYPE:
      return { ok: true, text: String(result.booleanValue), count: 1 };
    default: {
      const out: string[] = [];
      const serializer = new XMLSerializer();
      for (let node = result.iterateNext(); node; node = result.iterateNext()) {
        out.push(node.nodeType === Node.ATTRIBUTE_NODE || node.nodeType === Node.TEXT_NODE ? (node.nodeValue ?? "") : serializer.serializeToString(node));
      }
      return { ok: true, text: out.join("\n"), count: out.length };
    }
  }
}

/** Indents XML that parses; anything else comes back unchanged. */
export function prettyXml(text: string): string {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return text;
  const serializer = new XMLSerializer();
  const lines: string[] = [];
  const decl = /^\s*(<\?xml[^?]*\?>)/.exec(text)?.[1];
  if (decl) lines.push(decl);
  const attrs = (el: Element) => Array.from(el.attributes, (a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`).join("");
  const walk = (node: Node, depth: number) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const children = Array.from(el.childNodes).filter((c) => !(c.nodeType === Node.TEXT_NODE && !c.nodeValue?.trim()));
      if (children.length === 0) return lines.push(`${pad}<${el.tagName}${attrs(el)}/>`);
      if (children.length === 1 && children[0]!.nodeType === Node.TEXT_NODE) {
        return lines.push(`${pad}<${el.tagName}${attrs(el)}>${serializer.serializeToString(children[0]!).trim()}</${el.tagName}>`);
      }
      lines.push(`${pad}<${el.tagName}${attrs(el)}>`);
      children.forEach((c) => walk(c, depth + 1));
      lines.push(`${pad}</${el.tagName}>`);
    } else if (node.nodeType === Node.TEXT_NODE) {
      lines.push(`${pad}${serializer.serializeToString(node).trim()}`);
    } else {
      lines.push(`${pad}${serializer.serializeToString(node)}`);
    }
  };
  Array.from(doc.childNodes).forEach((n) => walk(n, 0));
  return lines.join("\n");
}

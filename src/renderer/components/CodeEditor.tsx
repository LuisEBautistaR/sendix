/**
 * Editable code with CodeMirror 6. The editor lives in a shadow root because
 * only there does CodeMirror use adoptedStyleSheets; in the document it would add
 * an inline <style>, which the strict CSP blocks. Colours come from the design
 * tokens, which custom properties carry into the shadow root.
 */
import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder as placeholderExt } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { tags as t } from "@lezer/highlight";
import type { Prefs } from "@shared/prefs";
import { useStore } from "../state/store";

export const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--syn-kw)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-str)" },
  { tag: [t.number], color: "var(--syn-num)" },
  { tag: [t.bool, t.null, t.atom], color: "var(--syn-lit)" },
  { tag: [t.propertyName], color: "var(--syn-key)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-com)", fontStyle: "italic" },
  { tag: [t.punctuation, t.bracket, t.separator], color: "var(--syn-punct)" },
]);

export const theme = EditorView.theme({
  // --code-size comes from Settings and crosses the shadow root like any inherited custom property.
  "&": { height: "100%", fontSize: "var(--code-size, 12px)", backgroundColor: "transparent", color: "var(--ink)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "calc(var(--code-size, 12px) + 7px)", fontVariantLigatures: "none", fontFeatureSettings: '"calt" 0, "liga" 0' },
  ".cm-content": { padding: "8px 0", caretColor: "var(--ink)" },
  ".cm-gutters": { backgroundColor: "var(--field)", border: "none", color: "var(--faint)" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "36px", padding: "0 10px 0 4px" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--select) !important" },
  ".cm-matchingBracket": { backgroundColor: "var(--select)", outline: "none" },
  ".cm-selectionMatch": { backgroundColor: "var(--var-bg)" },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-tooltip": { backgroundColor: "var(--field)", border: "1px solid var(--line)", borderRadius: "var(--radius)", boxShadow: "var(--shadow)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--mono)", fontSize: "12px", maxHeight: "220px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--select)", color: "var(--select-ink)" },
  ".cm-completionDetail": { fontFamily: "var(--ui)", color: "var(--muted)", fontStyle: "normal", marginLeft: "10px" },
  ".cm-completionIcon": { display: "none" },
  ".cm-panels": { backgroundColor: "var(--rail)", color: "var(--ink)", borderTop: "1px solid var(--line)" },
  ".cm-panels-top": { borderTop: "none", borderBottom: "1px solid var(--line)" },
  ".cm-panel.cm-search": { padding: "6px 8px", fontFamily: "var(--ui)", fontSize: "12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" },
  ".cm-panel.cm-search br": { display: "none" },
  ".cm-panel.cm-search label": { color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: "3px" },
  ".cm-panel.cm-search [name=close]": { position: "static", marginLeft: "auto", color: "var(--muted)", fontSize: "16px", padding: "0 4px" },
  ".cm-textfield": { height: "24px", padding: "0 6px", margin: "0", border: "1px solid var(--line)", borderRadius: "var(--radius)", backgroundColor: "var(--field)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: "12px", outline: "none" },
  ".cm-textfield:focus": { borderColor: "var(--focus)" },
  ".cm-button": { height: "24px", margin: "0", padding: "0 8px", border: "1px solid var(--line)", borderRadius: "var(--radius)", backgroundImage: "none", backgroundColor: "var(--field)", color: "var(--ink)", fontFamily: "var(--ui)", fontSize: "12px" },
  ".cm-button:hover": { borderColor: "var(--line-strong)" },
  ".cm-searchMatch": { backgroundColor: "var(--var-bg)", outline: "1px solid var(--line-strong)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--select)" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", color: "var(--faint)", cursor: "pointer" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--var-bg)", border: "none", color: "var(--var-ink)", padding: "0 4px", margin: "0 2px" },
});

/** Spanish labels for the search panel and folding. */
export const cmPhrases = EditorState.phrases.of({
  Find: "Buscar",
  Replace: "Reemplazar",
  next: "siguiente",
  previous: "anterior",
  all: "todas",
  "match case": "mayúsculas",
  regexp: "expresión regular",
  "by word": "palabra completa",
  replace: "reemplazar",
  "replace all": "reemplazar todas",
  close: "cerrar",
  "current match": "coincidencia actual",
  "on line": "en la línea",
  "Go to line": "Ir a la línea",
  go: "ir",
  "Folded lines": "Líneas plegadas",
  "Unfolded lines": "Líneas desplegadas",
  to: "a",
  "folded code": "código plegado",
  unfold: "desplegar",
  "Fold line": "Plegar línea",
  "Unfold line": "Desplegar línea",
});

/** Tab size, indent unit and auto-closing, from Settings. */
const editorPrefsExt = (p: Prefs["editor"]) => [
  EditorState.tabSize.of(p.tabSize),
  indentUnit.of(" ".repeat(p.tabSize)),
  ...(p.closeBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
];

const languageExt = (language: Props["language"]) => (language === "json" ? json() : language === "javascript" ? javascript() : []);

interface Props {
  value: string;
  onChange(value: string): void;
  language: "javascript" | "json" | "text";
  completions?: CompletionSource;
  placeholder?: string;
  label: string;
  testId?: string;
}

export function CodeEditor({ value, onChange, language, completions, placeholder, label, testId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lang = useRef(new Compartment());
  const editorPrefs = useRef(new Compartment());
  const prefs = useStore((s) => s.prefs.editor);

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        cmPhrases,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        editorPrefs.current.of(editorPrefsExt(prefs)),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        lang.current.of(languageExt(language)),
        syntaxHighlighting(highlight),
        autocompletion(completions ? { override: [completions], icons: false } : { icons: false }),
        // Ctrl+Enter belongs to the app (send or connect), not to "insert blank line".
        keymap.of([...defaultKeymap.filter((k) => k.key !== "Mod-Enter"), ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        ...(placeholder ? [placeholderExt(placeholder)] : []),
        EditorView.contentAttributes.of({ "aria-label": label, ...(testId ? { "data-testid": testId } : {}) }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        theme,
      ],
    });
    const el = host.current!;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    view.current = new EditorView({ state, root: shadow, parent: shadow });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // The editor is created once; value changes from outside are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageExt(language)) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: editorPrefs.current.reconfigure(editorPrefsExt(prefs)) });
  }, [prefs]);

  return <div className="cm-host" ref={host} />;
}

/** Inserts text at the cursor of the editor inside `container` (used by the snippet list). */
export function insertIntoEditor(container: HTMLElement | null, text: string): boolean {
  const el = container?.querySelector(".cm-host")?.shadowRoot?.querySelector(".cm-editor");
  const v = el ? EditorView.findFromDOM(el as HTMLElement) : null;
  if (!v) return false;
  const { from, to } = v.state.selection.main;
  const before = v.state.doc.sliceString(0, from);
  const prefix = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  v.dispatch({ changes: { from, to, insert: prefix + text }, selection: { anchor: from + prefix.length + text.length } });
  v.focus();
  return true;
}

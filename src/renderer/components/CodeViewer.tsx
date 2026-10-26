/**
 * Read-only code with CodeMirror 6: only the visible lines are in the DOM, so large
 * responses need no line cap. Folding, search (Ctrl F) and selection work as in the
 * editor; like it, it lives in a shadow root because of the CSP.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { codeFolding, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { xml } from "@codemirror/lang-xml";
import { html } from "@codemirror/lang-html";
import { cmPhrases, highlight, theme } from "./CodeEditor";

export type ViewerLanguage = "json" | "xml" | "html" | "javascript" | "text";

/** Above this size the text is shown without syntax colours so scrolling stays smooth. */
const MAX_HIGHLIGHT_CHARS = 5 * 1024 * 1024;

const languageExt = (language: ViewerLanguage, size: number) => {
  if (size > MAX_HIGHLIGHT_CHARS) return [];
  switch (language) {
    case "json":
      return json();
    case "xml":
      return xml();
    case "html":
      return html({ autoCloseTags: false });
    case "javascript":
      return javascript();
    default:
      return [];
  }
};

export interface CodeViewerHandle {
  openSearch(): void;
}

interface Props {
  text: string;
  language: ViewerLanguage;
  wrap: boolean;
  label: string;
  testId?: string;
}

export const CodeViewer = forwardRef<CodeViewerHandle, Props>(function CodeViewer({ text, language, wrap, label, testId }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const wrapping = useRef(new Compartment());

  useImperativeHandle(ref, () => ({
    openSearch: () => {
      if (!view.current) return;
      openSearchPanel(view.current);
    },
  }));

  useEffect(() => {
    const state = EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true),
        cmPhrases,
        lineNumbers(),
        codeFolding(),
        foldGutter({ openText: "▾", closedText: "▸" }),
        drawSelection(),
        highlightSelectionMatches(),
        search({ top: true }),
        lang.current.of(languageExt(language, text.length)),
        wrapping.current.of(wrap ? EditorView.lineWrapping : []),
        syntaxHighlighting(highlight),
        keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap]),
        EditorView.contentAttributes.of({ "aria-label": label, "aria-readonly": "true", ...(testId ? { "data-testid": testId } : {}) }),
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
    // Created once; text, language and wrapping changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    v.dispatch({
      ...(current !== text ? { changes: { from: 0, to: current.length, insert: text } } : {}),
      effects: lang.current.reconfigure(languageExt(language, text.length)),
    });
  }, [text, language]);

  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  return <div className="cm-host viewer" ref={host} />;
});

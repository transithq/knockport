import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

export type ViewerLanguage = "json" | "javascript" | "text";

function languageExtension(lang: ViewerLanguage) {
  if (lang === "json") return json();
  if (lang === "javascript") return javascript();
  return [];
}

interface CodeViewerProps {
  value: string;
  language?: ViewerLanguage;
  /** Soft-wrap long lines (text bodies); code views stay unwrapped. */
  wrap?: boolean;
}

/**
 * Read-only CodeMirror 6 viewer for response bodies (Bruno-style "editor"
 * view): real syntax highlighting, line numbers, and JSON brace folding via
 * basicSetup, without any editing affordances.
 */
export function CodeViewer({ value, language = "text", wrap = false }: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      basicSetup,
      oneDark,
      languageExtension(language),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.theme({
        "&": { fontSize: "12px", height: "100%" },
        ".cm-scroller": { overflow: "auto", fontFamily: "var(--kp-font-mono)" },
        ".cm-gutters": { minHeight: "100%" },
      }),
    ];
    if (wrap) extensions.push(EditorView.lineWrapping);

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="kp-code-viewer" />;
}

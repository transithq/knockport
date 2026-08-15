import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { scriptCompletions } from "./script-completions";
import { scriptLinter } from "./script-lint";

type Language = "json" | "javascript" | "text";

function languageExtension(lang: Language) {
  if (lang === "json") return json();
  // JS editors are script contexts (request/collection pre + test scripts)
  if (lang === "javascript") return [javascript(), scriptCompletions(), scriptLinter()];
  return [];
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: Language;
  placeholder?: string;
  height?: string;
}

/**
 * Lightweight CodeMirror 6 wrapper. Mounts an EditorView once and pushes
 * external value changes in only when they differ from the current doc,
 * avoiding cursor jumps while typing.
 */
export function CodeEditor({ value, onChange, language = "text", height = "200px" }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        languageExtension(language),
        EditorView.theme({
          "&": { fontSize: "12px", height },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--kp-font-mono)" },
          ".cm-content": { minHeight: height },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, height]);

  // Sync external value into the editor when it changes elsewhere.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="kp-code-editor" />;
}

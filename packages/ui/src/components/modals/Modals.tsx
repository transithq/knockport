import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, X, Download, Send } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";
import {
  buildVariableMap,
  effectiveScriptLayers,
  findCollectionOfRequest,
  resolveRequest,
} from "../../store/variables";
import {
  generateCode,
  importAuto,
  interfaceLanguages,
  generateInterface,
  type CodegenTarget,
  type InterfaceLanguageKey,
} from "@knockport/format";

// ── Lightweight syntax highlighting for generated code ──────────────────────
const JS_KW = new Set(["const", "let", "var", "await", "async", "function", "return", "import", "from", "export", "new", "if", "else", "for", "while", "try", "catch", "throw", "typeof"]);
const PY_KW = new Set(["import", "from", "def", "return", "if", "elif", "else", "for", "while", "try", "except", "with", "as", "print", "True", "False", "None"]);

function highlightLine(line: string, target: CodegenTarget): ReactNode[] {
  const nodes: ReactNode[] = [];
  let k = 0;
  const push = (cls: string | null, text: string) =>
    nodes.push(cls ? <span key={k++} className={cls}>{text}</span> : <span key={k++}>{text}</span>);

  if (target === "curl") {
    // flags in purple, quoted strings in blue
    const re = /(--?[a-zA-Z-]+)|('(?:[^'\\]|\\.)*')/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      if (m.index > last) push(null, line.slice(last, m.index));
      if (m[1]) push("tok-flag", m[1]);
      else if (m[2]) push("tok-str", m[2]);
      last = re.lastIndex;
    }
    if (last < line.length) push(null, line.slice(last));
    return nodes;
  }

  const kws = target === "javascript" ? JS_KW : PY_KW;
  // Find comment start outside of any quoted string (avoids "https://" in URLs).
  const marker = target === "javascript" ? "//" : "#";
  let commentStart = -1;
  for (let i = line.indexOf(marker); i !== -1; i = line.indexOf(marker, i + 1)) {
    const before = line.slice(0, i);
    const quotes = (before.match(/"/g)?.length ?? 0) + (before.match(/'/g)?.length ?? 0);
    if (quotes % 2 === 0) {
      commentStart = i;
      break;
    }
  }
  let codePart = line;
  if (commentStart !== -1) {
    codePart = line.slice(0, commentStart);
  }

  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(\d+(?:\.\d+)?)\b|([A-Za-z_][A-Za-z0-9_]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codePart)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    if (m.index > last) push(null, codePart.slice(last, m.index));
    if (m[1]) push("tok-str", m[1]);
    else if (m[2]) push("tok-num", m[2]);
    else if (m[3]) {
      const word = m[3];
      if (kws.has(word)) push("tok-kw", word);
      else if (codePart[re.lastIndex] === "(") push("tok-fn", word);
      else push(null, word);
    }
    last = re.lastIndex;
  }
  if (last < codePart.length) push(null, codePart.slice(last));
  if (commentStart !== -1) push("tok-comment", line.slice(commentStart));
  return nodes;
}

function CodeBlock({ code, target }: { code: string; target: CodegenTarget }) {
  return (
    <pre className="kp-code-block kp-mono kp-modal-code">
      {code.split("\n").map((line, i) => (
        <div key={i}>{highlightLine(line, target)}</div>
      ))}
    </pre>
  );
}

// ── Codegen Modal ────────────────────────────────────────────────────────────
export function CodegenModal() {
  const open = useAppStore((s) => s.codegenOpen);
  const setOpen = useAppStore((s) => s.setCodegenOpen);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const requests = useAppStore((s) => s.requests);
  const [target, setTarget] = useState<CodegenTarget>("curl");
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (!open || !activeTabId) return "";
    const state = useAppStore.getState();
    const request = requests[activeTabId];
    if (!request) return "";
    const resolved = resolveRequest(request, buildVariableMap(state));
    return generateCode(resolved, target);
  }, [open, activeTabId, target, requests]);

  if (!open) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="kp-cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Generate Code</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(false)}><X size={14} /></button>
        </div>
        <div className="kp-seg-row" style={{ padding: "0 14px" }}>
          {(["curl", "javascript", "python"] as CodegenTarget[]).map((t) => (
            <button key={t} type="button" className={clsx("kp-seg", target === t && "active")} onClick={() => setTarget(t)}>
              {t === "curl" ? "cURL" : t === "javascript" ? "JavaScript" : "Python"}
            </button>
          ))}
        </div>
        <CodeBlock code={code} target={target} />
        <div className="kp-modal-footer">
          <button type="button" className="kp-btn primary" onClick={copy}>
            <Copy size={14} /> {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Response Interface Modal (F3) ───────────────────────────────────────────
// Hoppscotch parity (H§6 `ResponseInterface.vue`): generate a typed interface
// / struct from the current response body via quicktype (`just-types`), across
// the same 22-language matrix Hoppscotch offers. Opened from the response
// statusbar ("Data schema").
export function InterfaceModal() {
  const open = useAppStore((s) => s.interfaceOpen);
  const setOpen = useAppStore((s) => s.setInterfaceOpen);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const responses = useAppStore((s) => s.responses);
  const [langKey, setLangKey] = useState<InterfaceLanguageKey>("TypeScript");
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const body = responses[activeTabId ?? ""]?.body ?? "";
    generateInterface(interfaceLanguages[langKey], body)
      .then((lines) => {
        if (cancelled) return;
        setCode(lines);
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setCode("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeTabId, langKey, responses]);

  if (!open) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const download = () => {
    const name = `response-interface-${interfaceLanguages[langKey]}.txt`;
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="kp-cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Data Schema</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(false)}><X size={14} /></button>
        </div>
        <div className="kp-interface-lang">
          <select
            className="kp-select"
            value={langKey}
            onChange={(e) => setLangKey(e.target.value as InterfaceLanguageKey)}
          >
            {Object.keys(interfaceLanguages).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <span className="kp-hint">
            Typed interface from the JSON response body
          </span>
        </div>
        {error ? (
          <p className="kp-import-error" style={{ margin: "10px 14px" }}>
            Could not generate an interface from this response.
          </p>
        ) : (
          <pre className="kp-code-block kp-mono kp-modal-code">
            {code ? code : "Generating…"}
          </pre>
        )}
        <div className="kp-modal-footer">
          <button type="button" className="kp-btn primary" onClick={copy} disabled={!code}>
            <Copy size={14} /> {copied ? "Copied!" : "Copy"}
          </button>
          <button type="button" className="kp-btn" onClick={download} disabled={!code}>
            <Download size={14} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Prompt Variables Modal (A5) ──────────────────────────────────────────────
// Sends that reference `{{$prompt.name}}` pause here for one answer per
// placeholder (Bruno parity). Answers resolve on Send (or in the runner,
// once per run); cancelling aborts the send.
export function PromptVariablesModal() {
  const pending = useAppStore((s) => s.promptVars);
  const setPromptVars = useAppStore((s) => s.setPromptVars);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pending) setValues(Object.fromEntries(pending.names.map((n) => [n, ""])));
  }, [pending]);

  if (!pending) return null;

  const answer = (answers: Record<string, string> | null) => {
    const { resolve } = pending;
    setPromptVars(null);
    resolve(answers);
  };

  return (
    <div className="kp-cmdk-overlay" onClick={() => answer(null)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Prompt variables</span>
          <button type="button" className="kp-icon-btn" onClick={() => answer(null)}>
            <X size={14} />
          </button>
        </div>
        <p className="kp-hint" style={{ padding: "0 14px" }}>
          This request references prompt variables — enter a value for each before sending.
        </p>
        <div className="kp-prompt-vars">
          {pending.names.map((name) => (
            <label key={name} className="kp-prompt-var">
              <span>{"{{$prompt." + name + "}}"}</span>
              <input
                type="text"
                value={values[name] ?? ""}
                autoFocus={name === pending.names[0]}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") answer(values);
                }}
                placeholder={name}
              />
            </label>
          ))}
        </div>
        <div className="kp-modal-footer">
          <button type="button" className="kp-btn" onClick={() => answer(null)}>
            Cancel
          </button>
          <button type="button" className="kp-btn primary" onClick={() => answer(values)}>
            <Send size={14} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import Modal ─────────────────────────────────────────────────────────────
export function ImportModal() {
  const open = useAppStore((s) => s.importOpen);
  const setOpen = useAppStore((s) => s.setImportOpen);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  const doImport = () => {
    try {
      const result = importAuto(text);
      const store = useAppStore.getState();
      if ("folders" in result) {
        store.addCollection(result);
        store.setSidebarTab("collections");
      } else if ("method" in result) {
        store.openTab(result);
      } else {
        // Environment
        store.addEnvironment(result);
        store.setSidebarTab("environments");
      }
      setText("");
      setError("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import");
    }
  };

  return (
    <div className="kp-cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Import Collection</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(false)}><X size={14} /></button>
        </div>
        <p className="kp-hint" style={{ padding: "0 14px" }}>
          Paste a cURL command, Postman collection/environment JSON, Postman environment
          JSON, or HAR file content.
        </p>
        <textarea
          className="kp-code-input kp-mono"
          style={{ margin: "10px 14px", width: "auto" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'curl -X GET https://api.example.com/users \\\n  -H "Authorization: Bearer token"'}
          spellCheck={false}
        />
        {error && <p className="kp-import-error">{error}</p>}
        <div className="kp-modal-footer">
          <button type="button" className="kp-btn primary" onClick={doImport} disabled={!text.trim()}>
            <Download size={14} /> Import
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inherited Scripts Modal (C10) ────────────────────────────────────────────
// Read-only viewer of the script chain a request's execution will run:
// collection, then each folder on the chain (root→parent), then the
// request's own — the same order the engine executes. Three phase tabs
// (pre / post / tests) with per-source labeled code blocks.
export function InheritedScriptsModal() {
  const requestId = useAppStore((s) => s.inheritScriptsRequest);
  const setOpen = useAppStore((s) => s.setInheritScriptsRequest);
  const collections = useAppStore((s) => s.collections);
  const requests = useAppStore((s) => s.requests);
  const [phase, setPhase] = useState<"pre" | "postResponse" | "test">("pre");

  const chain = useMemo(() => {
    if (!requestId) return null;
    const request = requests[requestId];
    if (!request) return null;
    const collection = findCollectionOfRequest(collections, requestId);
    return {
      request,
      collection,
      layers: effectiveScriptLayers(request, collection, phase),
    };
  }, [requestId, collections, requests, phase]);

  if (!requestId || !chain) return null;

  return (
    <div className="kp-cmdk-overlay" onClick={() => setOpen(null)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Scripts that run on send — {chain.request.name}</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(null)}>
            <X size={14} />
          </button>
        </div>
        <div className="kp-seg-row" style={{ padding: "0 14px" }}>
          {(
            [
              { id: "pre", label: "Pre-request" },
              { id: "postResponse", label: "Post-response" },
              { id: "test", label: "Tests" },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              className={clsx("kp-seg", phase === p.id && "active")}
              onClick={() => setPhase(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="kp-modal-code kp-inherit-scripts">
          {chain.layers.length === 0 ? (
            <p className="kp-hint">No scripts in this phase — the request runs with none.</p>
          ) : (
            chain.layers.map((layer, i) => (
              <div className="kp-inherit-layer" key={i}>
                <div className="kp-inherit-source">{layer.source}</div>
                <pre className="kp-code-block kp-mono">{layer.script}</pre>
              </div>
            ))
          )}
        </div>
        <div className="kp-modal-footer">
          <span className="kp-hint">Executed top-to-bottom in the order shown.</span>
        </div>
      </div>
    </div>
  );
}

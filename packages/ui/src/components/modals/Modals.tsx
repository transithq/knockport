import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, X, Download, Trash2, Plus } from "lucide-react";
import { clsx } from "clsx";
import type { Variable } from "@knockport/core";
import { useAppStore } from "../../store/app-store";
import { buildVariableMap, resolveRequest } from "../../store/variables";
import { generateCode, importAuto, type CodegenTarget } from "@knockport/format";

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
      } else {
        store.openTab(result);
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
          Paste a cURL command, Postman v2.1 JSON, or HAR file content.
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

// ── Environment Editor Modal ───────────────────────────────────────────────────
export function EnvironmentEditorModal() {
  const envId = useAppStore((s) => s.envEditorId);
  const setEnvEditor = useAppStore((s) => s.setEnvEditor);
  const environments = useAppStore((s) => s.environments);
  const updateEnvironment = useAppStore((s) => s.updateEnvironment);
  const env = environments.find((e) => e.id === envId);

  const [name, setName] = useState("");
  const [vars, setVars] = useState<Variable[]>([]);

  useEffect(() => {
    if (env) {
      setName(env.name);
      setVars(env.variables.map((v) => ({ ...v })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId]);

  if (!env) return null;

  const update = (i: number, field: keyof Variable, value: string | boolean) =>
    setVars((vs) => vs.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));

  const save = () => {
    updateEnvironment(env.id, {
      name: name.trim() || env.name,
      variables: vars.filter((v) => v.key.trim()),
    });
    setEnvEditor(null);
  };

  return (
    <div className="kp-cmdk-overlay" onClick={() => setEnvEditor(null)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Edit Environment</span>
          <button type="button" className="kp-icon-btn" onClick={() => setEnvEditor(null)}><X size={14} /></button>
        </div>
        <div style={{ padding: "10px 14px 0" }}>
          <input
            type="text"
            className="kp-env-name-input"
            value={name}
            placeholder="Environment name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="kp-kv-table" style={{ margin: "10px 14px" }}>
          <div className="kp-kv-row kp-kv-head">
            <span />
            <span>Variable</span>
            <span>Value</span>
            <span />
          </div>
          {vars.map((v, i) => (
            <div className="kp-kv-row" key={i}>
              <input
                type="checkbox"
                className="kp-checkbox"
                checked={v.enabled !== false}
                onChange={(e) => update(i, "enabled", e.target.checked)}
              />
              <input type="text" value={v.key} placeholder="variable_name" onChange={(e) => update(i, "key", e.target.value)} />
              <input type="text" value={v.value} placeholder="value" onChange={(e) => update(i, "value", e.target.value)} />
              <button
                type="button"
                className="kp-icon-btn kp-danger"
                title="Remove"
                onClick={() => setVars((vs) => vs.filter((_, idx) => idx !== i))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="kp-modal-footer">
          <button
            type="button"
            className="kp-btn"
            onClick={() => setVars((vs) => [...vs, { key: "", value: "", enabled: true }])}
          >
            <Plus size={14} /> Add Variable
          </button>
          <button type="button" className="kp-btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

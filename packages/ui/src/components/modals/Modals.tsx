import { useMemo, useState } from "react";
import { Copy, X, Download } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";
import { buildVariableMap, resolveRequest } from "../../store/variables";
import { generateCode, importAuto, type CodegenTarget } from "@knockport/format";

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
        <pre className="kp-code-block kp-mono kp-modal-code">{code}</pre>
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

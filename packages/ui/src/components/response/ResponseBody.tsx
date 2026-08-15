import { useMemo, useState } from "react";
import { Copy, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";

type BodyTab = "body" | "cookies" | "headers" | "tests";
type ViewTab = "pretty" | "raw" | "preview" | "visualize";

// ── JSON syntax highlighting (lightweight tokenizer) ─────────────────────────
function highlightJson(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) nodes.push(<span key={k++}>{line.slice(last, m.index)}</span>);
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        nodes.push(<span key={k++} className="tok-key">{m[1]}</span>);
        nodes.push(<span key={k++}>{m[2]}</span>);
      } else {
        nodes.push(<span key={k++} className="tok-str">{m[1]}</span>);
      }
    } else if (m[3] !== undefined) {
      nodes.push(<span key={k++} className="tok-bool">{m[3]}</span>);
    } else {
      nodes.push(<span key={k++} className="tok-num">{m[0]}</span>);
    }
    last = regex.lastIndex;
  }
  if (last < line.length) nodes.push(<span key={k++}>{line.slice(last)}</span>);
  return nodes;
}

function JsonViewer({ text }: { text: string }) {
  const lines = useMemo(() => {
    let formatted = text;
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // keep raw
    }
    return formatted.split("\n");
  }, [text]);

  return (
    <div className="kp-json-viewer kp-scroll">
      <table>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="kp-ln">{i + 1}</td>
              <td className="kp-code">{highlightJson(line)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

// ── Response Body (left-bottom panel) ────────────────────────────────────────
export function ResponseBody({ tabId }: { tabId: string }) {
  const responses = useAppStore((s) => s.responses);
  const testResults = useAppStore((s) => s.testResults[tabId]);
  const response = responses[tabId];
  const [bodyTab, setBodyTab] = useState<BodyTab>("body");
  const [viewTab, setViewTab] = useState<ViewTab>("pretty");

  if (!response) {
    return (
      <div className="kp-response-body">
        <div className="kp-empty-center">
          <p className="kp-empty-title">No response yet</p>
          <p className="kp-empty-sub">Send a request to see the response</p>
        </div>
      </div>
    );
  }

  const headerCount = Object.keys(response.headers).length;

  return (
    <div className="kp-response-body">
      {/* Top tabs */}
      <div className="kp-req-tabs">
        <button type="button" className={clsx("kp-req-tab", bodyTab === "body" && "active")} onClick={() => setBodyTab("body")}>Body</button>
        <button type="button" className={clsx("kp-req-tab", bodyTab === "cookies" && "active")} onClick={() => setBodyTab("cookies")}>Cookies</button>
        <button type="button" className={clsx("kp-req-tab", bodyTab === "headers" && "active")} onClick={() => setBodyTab("headers")}>
          Headers <span className="kp-tab-count">{headerCount}</span>
        </button>
        <button type="button" className={clsx("kp-req-tab", bodyTab === "tests" && "active")} onClick={() => setBodyTab("tests")}>
          Test Results {testResults && testResults.tests.length > 0 && <span className="kp-tab-count">{testResults.passed}/{testResults.tests.length}</span>}
        </button>
      </div>

      {bodyTab === "body" && (
        <>
          <div className="kp-view-row">
            <div className="kp-seg-row">
              {(["pretty", "raw", "preview", "visualize"] as ViewTab[]).map((v) => (
                <button key={v} type="button" className={clsx("kp-seg", viewTab === v && "active")} onClick={() => setViewTab(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <button type="button" className="kp-lang-btn">
              JSON <ChevronDown size={12} />
            </button>
          </div>

          {viewTab === "pretty" && <JsonViewer text={response.body} />}
          {viewTab === "raw" && <pre className="kp-raw-view kp-scroll kp-mono">{response.body}</pre>}
          {viewTab === "preview" && (
            <iframe title="preview" className="kp-preview-frame" srcDoc={response.body} sandbox="" />
          )}
          {viewTab === "visualize" && (
            <div className="kp-empty-center"><p className="kp-empty-sub">Visualize scripts run here (coming soon)</p></div>
          )}

          <div className="kp-body-statusbar">
            <button type="button" className="kp-lang-btn">JSON <ChevronDown size={12} /></button>
            <span className="kp-status-right">
              <span>Ln 1, Col 1</span>
              <span>Size: {formatSize(response.bodySize)}</span>
              <button type="button" className="kp-icon-btn" title="Copy"><Copy size={13} /></button>
            </span>
          </div>
        </>
      )}

      {bodyTab === "headers" && (
        <div className="kp-kv-list kp-scroll">
          {Object.entries(response.headers).map(([k, v]) => (
            <div className="kp-kv-list-row" key={k}>
              <span className="kp-kv-key">{k}</span>
              <span className="kp-kv-val kp-mono">{v}</span>
            </div>
          ))}
        </div>
      )}

      {bodyTab === "cookies" && (
        <div className="kp-kv-list kp-scroll">
          {response.cookies.length === 0 && <p className="kp-hint">No cookies</p>}
          {response.cookies.map((c) => (
            <div className="kp-kv-list-row" key={c.name}>
              <span className="kp-kv-key">{c.name}</span>
              <span className="kp-kv-val kp-mono">{c.value}</span>
            </div>
          ))}
        </div>
      )}

      {bodyTab === "tests" && (
        <div className="kp-tests-list kp-scroll">
          {!testResults && (
            <div className="kp-empty-center">
              <p className="kp-empty-sub">No tests were run for this request</p>
              <p className="kp-empty-sub">Add a test script or assertions in the Scripts / Tests tabs</p>
            </div>
          )}
          {testResults && (
            <>
              <div className="kp-tests-summary">
                <span className={`kp-runner-status ${testResults.failed === 0 && !testResults.scriptError ? "ok" : "fail"}`}>
                  {testResults.failed === 0 && !testResults.scriptError ? "PASS" : "FAIL"}
                </span>
                <span className="kp-hint">
                  {testResults.passed}/{testResults.tests.length} passed • {testResults.duration.toFixed(1)} ms
                </span>
              </div>
              {testResults.scriptError && (
                <div className="kp-test-error">Script error: {testResults.scriptError}</div>
              )}
              {testResults.tests.length === 0 && !testResults.scriptError && (
                <p className="kp-hint">The script defined no tests.</p>
              )}
              {testResults.tests.map((t, i) => (
                <div className="kp-test-row" key={i}>
                  <span className={`kp-runner-status ${t.passed ? "ok" : "fail"}`}>{t.passed ? "PASS" : "FAIL"}</span>
                  <span className="kp-test-name">{t.name}</span>
                  {t.message && <span className="kp-test-msg kp-mono">{t.message}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

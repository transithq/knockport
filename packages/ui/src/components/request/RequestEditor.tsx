import { useState } from "react";
import { Send, Loader2, ChevronDown, MoreHorizontal, Copy, Code2, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore, type ActivePanel } from "../../store/app-store";
import { HTTP_METHODS, type HttpMethod, type KeyValuePair, type BodyContent, type AuthConfig, type Assertion } from "@knockport/core";
import { buildVariableMap, environmentVariableMap, resolveRequest } from "../../store/variables";
import { CodeEditor } from "../common/CodeEditor";

const methodColor: Record<string, string> = {
  GET: "var(--kp-method-get)",
  POST: "var(--kp-method-post)",
  PUT: "var(--kp-method-put)",
  PATCH: "var(--kp-method-patch)",
  DELETE: "var(--kp-method-delete)",
  HEAD: "var(--kp-method-head)",
  OPTIONS: "var(--kp-method-options)",
};

// ── Request Editor ───────────────────────────────────────────────────────────
export function RequestEditor({ tabId }: { tabId: string }) {
  const requests = useAppStore((s) => s.requests);
  const isLoading = useAppStore((s) => s.isLoading);
  const updateRequestMethod = useAppStore((s) => s.updateRequestMethod);
  const updateRequestUrl = useAppStore((s) => s.updateRequestUrl);
  const activeRequestPanel = useAppStore((s) => s.activeRequestPanel);
  const setActiveRequestPanel = useAppStore((s) => s.setActiveRequestPanel);

  const request = requests[tabId];
  if (!request) return null;
  const loading = isLoading[tabId] ?? false;

  const requestTabs: { id: ActivePanel; label: string; dot?: boolean; count?: number }[] = [
    { id: "params", label: "Params", dot: request.params.some((p) => p.enabled) },
    { id: "headers", label: "Headers", count: request.headers.filter((h) => h.enabled).length || undefined },
    { id: "auth", label: "Authorization" },
    { id: "body", label: "Body" },
    { id: "scripts", label: "Scripts" },
    { id: "tests", label: "Tests" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="kp-request-editor">
      {/* URL bar */}
      <div className="kp-urlbar">
        <div className="kp-method-select">
          <select
            value={request.method}
            onChange={(e) => updateRequestMethod(tabId, e.target.value as HttpMethod)}
            style={{ color: methodColor[request.method] }}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <ChevronDown size={13} className="kp-select-caret" />
        </div>

        <input
          type="text"
          value={request.url}
          onChange={(e) => updateRequestUrl(tabId, e.target.value)}
          placeholder="https://api.example.com/endpoint"
          className="kp-url-input kp-mono"
        />

        <button
          type="button"
          className="kp-send-btn"
          disabled={loading || !request.url}
          onClick={() => handleSend(tabId)}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Send
        </button>
        <button type="button" className="kp-send-caret" title="Send options">
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className="kp-icon-btn"
          title="Generate code"
          onClick={() => useAppStore.getState().setCodegenOpen(true)}
        >
          <Code2 size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div className="kp-req-tabs">
        {requestTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={clsx("kp-req-tab", activeRequestPanel === t.id && "active")}
            onClick={() => setActiveRequestPanel(t.id)}
          >
            {t.label}
            {t.dot && <span className="kp-tab-dot" />}
            {t.count !== undefined && <span className="kp-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="kp-req-panel kp-scroll">
        {activeRequestPanel === "params" && (
          <KeyValueTable
            title="Query Params"
            pairs={request.params}
            onChange={(p) => useAppStore.getState().updateRequestParams(tabId, p)}
          />
        )}
        {activeRequestPanel === "headers" && (
          <KeyValueTable
            title="Headers"
            pairs={request.headers}
            onChange={(h) => useAppStore.getState().updateRequestHeaders(tabId, h)}
          />
        )}
        {activeRequestPanel === "auth" && (
          <AuthEditor auth={request.auth} onChange={(a) => useAppStore.getState().updateRequestAuth(tabId, a)} />
        )}
        {activeRequestPanel === "body" && (
          <BodyEditor body={request.body} onChange={(b) => useAppStore.getState().updateRequestBody(tabId, b)} />
        )}
        {activeRequestPanel === "scripts" && <ScriptEditor tabId={tabId} />}
        {activeRequestPanel === "tests" && <TestsPanel tabId={tabId} />}
        {activeRequestPanel === "settings" && <RequestSettings />}
      </div>
    </div>
  );
}

// ── Key-Value Table (matches design: checkbox | Key | Value | Description) ───
function KeyValueTable({
  title,
  pairs,
  onChange,
}: {
  title: string;
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
}) {
  const update = (i: number, field: keyof KeyValuePair, value: string | boolean) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));

  const [newKey, setNewKey] = useState("");
  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...pairs, { key: newKey.trim(), value: "", enabled: true }]);
      setNewKey("");
    }
  };

  return (
    <div className="kp-kv">
      <div className="kp-kv-title">{title}</div>
      <div className="kp-kv-table">
        <div className="kp-kv-row kp-kv-head">
          <span />
          <span>Key</span>
          <span>Value</span>
          <span>Description</span>
          <span className="kp-kv-menu"><MoreHorizontal size={13} /></span>
        </div>

        {pairs.map((pair, i) => (
          <div className="kp-kv-row" key={i}>
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={pair.enabled}
              onChange={(e) => update(i, "enabled", e.target.checked)}
            />
            <input
              type="text"
              value={pair.key}
              placeholder="Key"
              onChange={(e) => update(i, "key", e.target.value)}
            />
            <input
              type="text"
              value={pair.value}
              placeholder="Value"
              onChange={(e) => update(i, "value", e.target.value)}
            />
            <input
              type="text"
              value={pair.description ?? ""}
              placeholder="Description"
              onChange={(e) => update(i, "description", e.target.value)}
            />
            <span />
          </div>
        ))}

        {/* Empty add row */}
        <div className="kp-kv-row kp-kv-empty">
          <span />
          <input
            type="text"
            placeholder="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitNew()}
            onBlur={commitNew}
          />
          <input type="text" placeholder="Value" readOnly />
          <input type="text" placeholder="Description" readOnly />
          <span />
        </div>
      </div>
    </div>
  );
}

// ── Body Editor ──────────────────────────────────────────────────────────────
function BodyEditor({ body, onChange }: { body: BodyContent; onChange: (b: BodyContent) => void }) {
  const types: BodyContent["type"][] = ["none", "json", "text", "xml", "html", "form-urlencoded", "multipart-form", "graphql"];
  const label = (t: string) =>
    t === "form-urlencoded" ? "Form" : t === "multipart-form" ? "Multipart" : t.charAt(0).toUpperCase() + t.slice(1);

  return (
    <div className="kp-body-editor">
      <div className="kp-seg-row">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className={clsx("kp-seg", body.type === t && "active")}
            onClick={() => onChange({ ...body, type: t })}
          >
            {label(t)}
          </button>
        ))}
      </div>
      {body.type !== "none" && (
        <CodeEditor
          value={body.content ?? ""}
          onChange={(content) => onChange({ ...body, content })}
          language={body.type === "json" ? "json" : "text"}
          height="200px"
        />
      )}
    </div>
  );
}

// ── Auth Editor ──────────────────────────────────────────────────────────────
function AuthEditor({ auth, onChange }: { auth: AuthConfig; onChange: (a: AuthConfig) => void }) {
  const types: AuthConfig["type"][] = ["none", "inherit", "bearer", "basic", "apiKey", "oauth2"];
  const label = (t: string) => (t === "apiKey" ? "API Key" : t.charAt(0).toUpperCase() + t.slice(1));

  return (
    <div className="kp-body-editor">
      <div className="kp-seg-row">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className={clsx("kp-seg", auth.type === t && "active")}
            onClick={() => onChange({ type: t })}
          >
            {label(t)}
          </button>
        ))}
      </div>

      {auth.type === "bearer" && (
        <div className="kp-field">
          <label>Token</label>
          <input
            type="text"
            className="kp-mono"
            value={auth.bearer?.token ?? ""}
            placeholder="Enter bearer token"
            onChange={(e) => onChange({ ...auth, bearer: { token: e.target.value } })}
          />
        </div>
      )}
      {auth.type === "basic" && (
        <div className="kp-field-grid">
          <div className="kp-field">
            <label>Username</label>
            <input
              type="text"
              value={auth.basic?.username ?? ""}
              onChange={(e) => onChange({ ...auth, basic: { username: e.target.value, password: auth.basic?.password ?? "" } })}
            />
          </div>
          <div className="kp-field">
            <label>Password</label>
            <input
              type="password"
              value={auth.basic?.password ?? ""}
              onChange={(e) => onChange({ ...auth, basic: { username: auth.basic?.username ?? "", password: e.target.value } })}
            />
          </div>
        </div>
      )}
      {auth.type === "none" && <p className="kp-hint">No authentication</p>}
      {auth.type === "inherit" && <p className="kp-hint">Inherit from parent collection</p>}
    </div>
  );
}

// ── Script Editor ────────────────────────────────────────────────────────────
function ScriptEditor({ tabId }: { tabId: string }) {
  const requests = useAppStore((s) => s.requests);
  const updateRequest = useAppStore((s) => s.updateRequest);
  const request = requests[tabId];
  const [which, setWhich] = useState<"pre" | "test">("pre");
  if (!request) return null;
  const value = which === "pre" ? request.scripts?.pre ?? "" : request.scripts?.test ?? "";

  return (
    <div className="kp-body-editor">
      <div className="kp-seg-row">
        <button type="button" className={clsx("kp-seg", which === "pre" && "active")} onClick={() => setWhich("pre")}>
          Pre-request
        </button>
        <button type="button" className={clsx("kp-seg", which === "test" && "active")} onClick={() => setWhich("test")}>
          Tests
        </button>
      </div>
      <CodeEditor
        value={value}
        onChange={(v) => updateRequest(tabId, { scripts: { ...request.scripts, [which]: v } })}
        language="javascript"
        height="200px"
      />
    </div>
  );
}

// ── Tests Panel ──────────────────────────────────────────────────────────────
function TestsPanel({ tabId }: { tabId: string }) {
  const requests = useAppStore((s) => s.requests);
  const updateRequest = useAppStore((s) => s.updateRequest);
  const request = requests[tabId];
  if (!request) return null;
  const assertions = request.assertions ?? [];
  const setAssertions = (list: Assertion[]) => updateRequest(tabId, { assertions: list });

  return (
    <div className="kp-hint-block">
      <p>Quick assertions evaluated against <code className="kp-mono kp-accent-text">response</code> — must return <code className="kp-mono kp-accent-text">true</code> to pass:</p>
      <div className="kp-tests-editor">
        {assertions.map((a, i) => (
          <div className="kp-test-edit-row" key={i}>
            <input
              className="kp-mono"
              value={a.expression}
              placeholder="response.status === 200"
              onChange={(e) => {
                const next = [...assertions];
                next[i] = { ...next[i], expression: e.target.value };
                setAssertions(next);
              }}
            />
            <input
              value={a.description ?? ""}
              placeholder="description (optional)"
              onChange={(e) => {
                const next = [...assertions];
                next[i] = { ...next[i], description: e.target.value || undefined };
                setAssertions(next);
              }}
            />
            <button type="button" className="kp-icon-btn" title="Remove" onClick={() => setAssertions(assertions.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="kp-lang-btn" onClick={() => setAssertions([...assertions, { expression: "" }])}>
          <Plus size={12} /> Add assertion
        </button>
      </div>
      <p>For full control, write test scripts in the <strong>Scripts</strong> tab — <code className="kp-mono kp-accent-text">kp.*</code>, <code className="kp-mono kp-accent-text">pm.*</code> and <code className="kp-mono kp-accent-text">bru.*</code> are all supported:</p>
      <pre className="kp-code-block kp-mono">{`kp.test("Status is 200", () => {
  kp.response.to.have.status(200);
});

pm.test("Response has data", () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property("data");
});

// response CODE is numeric; pm.response.status is the reason text
kp.test("fast enough", () => {
  chai.expect(kp.response.responseTime).to.be.below(2000);
});`}</pre>
    </div>
  );
}

// ── Request Settings ─────────────────────────────────────────────────────────
function RequestSettings() {
  const useRelay = useAppStore((s) => s.useRelay);
  const relayUrl = useAppStore((s) => s.relayUrl);
  const setUseRelay = useAppStore((s) => s.setUseRelay);
  const setRelayUrl = useAppStore((s) => s.setRelayUrl);

  return (
    <div className="kp-settings">
      <div className="kp-setting-row">
        <label>Follow Redirects</label>
        <input type="checkbox" className="kp-checkbox" defaultChecked />
      </div>
      <div className="kp-setting-row">
        <label>Verify SSL</label>
        <input type="checkbox" className="kp-checkbox" defaultChecked />
      </div>
      <div className="kp-setting-row">
        <label>Timeout (ms)</label>
        <input type="number" defaultValue={30000} className="kp-num-input" />
      </div>
      <div className="kp-setting-row">
        <label>Send via relay (bypasses CORS)</label>
        <input
          type="checkbox"
          className="kp-checkbox"
          checked={useRelay}
          onChange={(e) => setUseRelay(e.target.checked)}
        />
      </div>
      {useRelay && (
        <div className="kp-setting-row">
          <label>Relay URL</label>
          <input
            type="text"
            className="kp-text-input"
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="http://localhost:8787"
          />
        </div>
      )}
    </div>
  );
}

// ── Send ─────────────────────────────────────────────────────────────────────
async function handleSend(tabId: string) {
  const store = useAppStore.getState();
  const request = store.requests[tabId];
  if (!request) return;

  store.setLoading(tabId, true);
  try {
    const { getTransport } = await import("@knockport/transport");
    let vars = buildVariableMap(store);
    if (request.scripts?.pre?.trim()) {
      const { runPreScript } = await import("@knockport/engine");
      vars = runPreScript(request.scripts.pre, vars, {
        environment: environmentVariableMap(store),
        request,
      }).variables;
    }
    const resolved = resolveRequest(request, vars);
    const transport = getTransport({ useRelay: store.useRelay, relayUrl: store.relayUrl });
    const response = await transport.execute(resolved);
    store.setResponse(tabId, response);

    // Run test scripts + assertions (interim TS runner; wasm engine in M3)
    const hasTests = Boolean(request.scripts?.test?.trim() || request.assertions?.length);
    if (hasTests) {
      const { runTests } = await import("@knockport/engine");
      const summary = await runTests(response, {
        script: request.scripts?.test,
        assertions: request.assertions,
        environment: environmentVariableMap(store),
        request: resolved,
      });
      store.setTestResults(tabId, summary);
    } else {
      store.setTestResults(tabId, null);
    }

    store.addHistoryEntry({
      id: crypto.randomUUID(),
      request: resolved,
      response,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    store.setTestResults(tabId, null);
    store.setResponse(tabId, {
      id: crypto.randomUUID(),
      requestId: request.id,
      status: 0,
      statusText: err instanceof Error ? err.message : "Request failed",
      headers: {},
      body: "",
      bodySize: 0,
      timings: { total: 0, ttfb: 0, download: 0 },
      cookies: [],
      timestamp: new Date().toISOString(),
    });
  } finally {
    store.setLoading(tabId, false);
  }
}

import React from "react";
import { useAppStore, type ActivePanel } from "../../store/app-store";
import { HTTP_METHODS, type HttpMethod, type KeyValuePair } from "@knockport/core";
import { Tabs, Button } from "../common/primitives";
import { Send, Loader2, Plus, Trash2, ChevronDown } from "lucide-react";
import { clsx } from "clsx";

// ── Request Editor ───────────────────────────────────────────────────────────
export function RequestEditor() {
  const {
    activeTabId,
    requests,
    isLoading,
    updateRequestMethod,
    updateRequestUrl,
    updateRequestHeaders,
    updateRequestParams,
    updateRequestBody,
    activeRequestPanel,
    setActiveRequestPanel,
  } = useAppStore();

  if (!activeTabId || !requests[activeTabId]) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--kp-text-muted)]">
        <p className="text-sm">Select a request to get started</p>
      </div>
    );
  }

  const tabId = activeTabId;
  const request = requests[tabId];
  const loading = isLoading[tabId] ?? false;
  const enabledHeaders = request.headers.filter((h) => h.enabled).length;

  const requestTabs = [
    { id: "params", label: "Params", count: request.params.filter((p) => p.enabled).length || undefined },
    { id: "headers", label: "Headers", count: enabledHeaders || undefined },
    { id: "auth", label: "Authorization" },
    { id: "body", label: "Body" },
    { id: "scripts", label: "Scripts" },
    { id: "tests", label: "Tests" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* URL Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--kp-border-primary)]">
        {/* Method selector */}
        <div className="relative">
          <select
            value={request.method}
            onChange={(e) => updateRequestMethod(tabId, e.target.value as HttpMethod)}
            className={clsx(
              "h-8 px-2 pr-6 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs font-bold appearance-none cursor-pointer focus:outline-none focus:border-[var(--kp-border-focus)]",
              getMethodTextColor(request.method),
            )}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--kp-text-muted)]"
          />
        </div>

        {/* URL input */}
        <input
          type="text"
          value={request.url}
          onChange={(e) => updateRequestUrl(tabId, e.target.value)}
          placeholder="https://api.example.com/endpoint"
          className="flex-1 h-8 px-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-sm font-mono text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)]"
        />

        {/* Send button */}
        <Button
          variant="primary"
          onClick={() => handleSend(tabId)}
          disabled={loading || !request.url}
          icon={loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        >
          {loading ? "Sending" : "Send"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <Tabs
          tabs={requestTabs}
          active={activeRequestPanel}
          onChange={(id) => setActiveRequestPanel(id as ActivePanel)}
        />
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-auto p-4">
        {activeRequestPanel === "params" && (
          <KeyValueEditor
            pairs={request.params}
            onChange={(params) => updateRequestParams(tabId, params)}
            keyPlaceholder="Parameter"
            valuePlaceholder="Value"
          />
        )}
        {activeRequestPanel === "headers" && (
          <KeyValueEditor
            pairs={request.headers}
            onChange={(headers) => updateRequestHeaders(tabId, headers)}
            keyPlaceholder="Header"
            valuePlaceholder="Value"
          />
        )}
        {activeRequestPanel === "body" && (
          <BodyEditor
            body={request.body}
            onChange={(body) => updateRequestBody(tabId, body)}
          />
        )}
        {activeRequestPanel === "auth" && (
          <AuthEditor auth={request.auth} onChange={(auth) => useAppStore.getState().updateRequestAuth(tabId, auth)} />
        )}
        {activeRequestPanel === "scripts" && (
          <ScriptEditor
            preScript={request.scripts?.pre ?? ""}
            testScript={request.scripts?.test ?? ""}
          />
        )}
        {activeRequestPanel === "tests" && (
          <div className="text-xs text-[var(--kp-text-tertiary)]">
            <p className="mb-2">Write test assertions using the <code className="kp-mono text-[var(--kp-accent)]">kp.*</code> API:</p>
            <pre className="p-3 bg-[var(--kp-bg-tertiary)] rounded-md text-xs font-mono text-[var(--kp-text-secondary)] overflow-auto">
{`kp.test("Status is 200", () => {
  kp.response.to.have.status(200);
});

kp.test("Response has data", () => {
  const json = kp.response.json();
  kp.expect(json).to.have.property("data");
});`}
            </pre>
          </div>
        )}
        {activeRequestPanel === "settings" && (
          <RequestSettings />
        )}
      </div>
    </div>
  );
}

// ── Key-Value Editor ─────────────────────────────────────────────────────────
interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

function KeyValueEditor({ pairs, onChange, keyPlaceholder, valuePlaceholder }: KeyValueEditorProps) {
  const handleAdd = () => {
    onChange([...pairs, { key: "", value: "", enabled: true }]);
  };

  const handleRemove = (index: number) => {
    onChange(pairs.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: keyof KeyValuePair, value: string | boolean) => {
    const updated = pairs.map((p, i) =>
      i === index ? { ...p, [field]: value } : p,
    );
    onChange(updated);
  };

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[32px_1fr_1fr_28px] gap-2 text-[10px] text-[var(--kp-text-muted)] uppercase tracking-wider mb-2 px-1">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>

      {pairs.map((pair, index) => (
        <div
          key={index}
          className="grid grid-cols-[32px_1fr_1fr_28px] gap-2 items-center"
        >
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => handleChange(index, "enabled", e.target.checked)}
            className="w-3.5 h-3.5 rounded border-[var(--kp-border-primary)] accent-[var(--kp-accent)]"
          />
          <input
            type="text"
            value={pair.key}
            onChange={(e) => handleChange(index, "key", e.target.value)}
            placeholder={keyPlaceholder}
            className="h-7 px-2 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded text-xs text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)]"
          />
          <input
            type="text"
            value={pair.value}
            onChange={(e) => handleChange(index, "value", e.target.value)}
            placeholder={valuePlaceholder}
            className="h-7 px-2 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded text-xs text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)]"
          />
          <button
            onClick={() => handleRemove(index)}
            className="p-1 rounded hover:bg-[var(--kp-bg-hover)] text-[var(--kp-text-muted)] hover:text-[var(--kp-error)]"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}

      <button
        onClick={handleAdd}
        className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--kp-text-tertiary)] hover:text-[var(--kp-text-secondary)] transition-colors"
      >
        <Plus size={12} />
        Add row
      </button>
    </div>
  );
}

// ── Body Editor ──────────────────────────────────────────────────────────────
function BodyEditor({
  body,
  onChange,
}: {
  body: import("@knockport/core").BodyContent;
  onChange: (body: import("@knockport/core").BodyContent) => void;
}) {
  const bodyTypes = ["none", "json", "text", "xml", "html", "form-urlencoded", "multipart-form", "graphql"] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {bodyTypes.map((type) => (
          <button
            key={type}
            onClick={() => onChange({ ...body, type })}
            className={clsx(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              body.type === type
                ? "bg-[var(--kp-accent-muted)] text-[var(--kp-accent)]"
                : "text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]",
            )}
          >
            {type === "form-urlencoded" ? "Form" : type === "multipart-form" ? "Multipart" : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {body.type !== "none" && (
        <textarea
          value={body.content ?? ""}
          onChange={(e) => onChange({ ...body, content: e.target.value })}
          placeholder={body.type === "json" ? '{\n  "key": "value"\n}' : "Enter request body..."}
          className="w-full h-64 p-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs font-mono text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)] resize-y"
          spellCheck={false}
        />
      )}
    </div>
  );
}

// ── Auth Editor ──────────────────────────────────────────────────────────────
function AuthEditor({
  auth,
  onChange,
}: {
  auth: import("@knockport/core").AuthConfig;
  onChange: (auth: import("@knockport/core").AuthConfig) => void;
}) {
  const authTypes = ["none", "inherit", "bearer", "basic", "apiKey", "oauth2"] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {authTypes.map((type) => (
          <button
            key={type}
            onClick={() => onChange({ type, ...auth })}
            className={clsx(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              auth.type === type
                ? "bg-[var(--kp-accent-muted)] text-[var(--kp-accent)]"
                : "text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]",
            )}
          >
            {type === "apiKey" ? "API Key" : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {auth.type === "bearer" && (
        <div className="space-y-2">
          <label className="text-xs text-[var(--kp-text-secondary)]">Token</label>
          <input
            type="text"
            value={auth.bearer?.token ?? ""}
            onChange={(e) => onChange({ ...auth, bearer: { token: e.target.value } })}
            placeholder="Enter bearer token"
            className="w-full h-8 px-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs font-mono text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)]"
          />
        </div>
      )}

      {auth.type === "basic" && (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-[var(--kp-text-secondary)]">Username</label>
            <input
              type="text"
              value={auth.basic?.username ?? ""}
              onChange={(e) => onChange({ ...auth, basic: { ...auth.basic!, username: e.target.value } })}
              className="w-full h-8 px-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs text-[var(--kp-text-primary)] focus:outline-none focus:border-[var(--kp-border-focus)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--kp-text-secondary)]">Password</label>
            <input
              type="password"
              value={auth.basic?.password ?? ""}
              onChange={(e) => onChange({ ...auth, basic: { ...auth.basic!, password: e.target.value } })}
              className="w-full h-8 px-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs text-[var(--kp-text-primary)] focus:outline-none focus:border-[var(--kp-border-focus)]"
            />
          </div>
        </div>
      )}

      {auth.type === "none" && (
        <p className="text-xs text-[var(--kp-text-tertiary)]">No authentication</p>
      )}
      {auth.type === "inherit" && (
        <p className="text-xs text-[var(--kp-text-tertiary)]">Inherit from parent collection</p>
      )}
    </div>
  );
}

// ── Script Editor ────────────────────────────────────────────────────────────
function ScriptEditor({
  preScript,
  testScript,
}: {
  preScript: string;
  testScript: string;
}) {
  const [activeScript, setActiveScript] = React.useState<"pre" | "test">("pre");

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => setActiveScript("pre")}
          className={clsx(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            activeScript === "pre"
              ? "bg-[var(--kp-accent-muted)] text-[var(--kp-accent)]"
              : "text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]",
          )}
        >
          Pre-request
        </button>
        <button
          onClick={() => setActiveScript("test")}
          className={clsx(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            activeScript === "test"
              ? "bg-[var(--kp-accent-muted)] text-[var(--kp-accent)]"
              : "text-[var(--kp-text-secondary)] hover:bg-[var(--kp-bg-hover)]",
          )}
        >
          Tests
        </button>
      </div>

      <textarea
        value={activeScript === "pre" ? preScript : testScript}
        readOnly
        placeholder={
          activeScript === "pre"
            ? "// Pre-request script — runs before the request\n// Use kp.variables.set('key', value)"
            : "// Test script — runs after the response\n// Use kp.test('name', () => { ... })"
        }
        className="w-full h-48 p-3 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded-md text-xs font-mono text-[var(--kp-text-primary)] placeholder:text-[var(--kp-text-muted)] focus:outline-none focus:border-[var(--kp-border-focus)] resize-y"
        spellCheck={false}
      />
    </div>
  );
}

// ── Request Settings ─────────────────────────────────────────────────────────
function RequestSettings() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--kp-text-secondary)] w-32">Follow Redirects</label>
        <input type="checkbox" defaultChecked className="accent-[var(--kp-accent)]" />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--kp-text-secondary)] w-32">Verify SSL</label>
        <input type="checkbox" defaultChecked className="accent-[var(--kp-accent)]" />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--kp-text-secondary)] w-32">Timeout (ms)</label>
        <input
          type="number"
          defaultValue={30000}
          className="w-24 h-7 px-2 bg-[var(--kp-bg-tertiary)] border border-[var(--kp-border-primary)] rounded text-xs text-[var(--kp-text-primary)] focus:outline-none focus:border-[var(--kp-border-focus)]"
        />
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function handleSend(tabId: string) {
  const store = useAppStore.getState();
  const request = store.requests[tabId];
  if (!request) return;

  store.setLoading(tabId, true);

  try {
    const { DirectTransport } = await import("@knockport/transport");
    const transport = new DirectTransport();
    const response = await transport.execute(request);
    store.setResponse(tabId, response);

    // Add to history
    store.addHistoryEntry({
      id: crypto.randomUUID(),
      request,
      response,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
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

function getMethodTextColor(method: string): string {
  const colors: Record<string, string> = {
    GET: "text-[var(--kp-method-get)]",
    POST: "text-[var(--kp-method-post)]",
    PUT: "text-[var(--kp-method-put)]",
    PATCH: "text-[var(--kp-method-patch)]",
    DELETE: "text-[var(--kp-method-delete)]",
    HEAD: "text-[var(--kp-method-head)]",
    OPTIONS: "text-[var(--kp-method-options)]",
  };
  return colors[method] ?? "text-[var(--kp-text-secondary)]";
}

import {
  type Assertion,
  type BodyContent,
  type FormDataEntry,
  HTTP_METHODS,
  type HttpMethod,
  type KeyValuePair,
} from "@knockport/core";
import type { TestRunSummary } from "@knockport/engine";
import { clsx } from "clsx";
import { ChevronDown, Code2, Loader2, MoreHorizontal, Paperclip, Save, Send, X } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { type ActivePanel, useAppStore } from "../../store/app-store";
import {
  buildVariableMap,
  collectionVariablesMap,
  environmentVariableMap,
  findCollectionOfRequest,
  resolveRequest,
} from "../../store/variables";
import { AssertionsEditor } from "../common/AssertionsEditor";
import { AuthEditor } from "../common/AuthEditor";
import { CodeEditor } from "../common/CodeEditor";
import { type Suggestion, SuggestInput } from "../common/SuggestInput";
import { DropdownMenu } from "../common/DropdownMenu";
import { displayUrl, parseQuery, splitQuery } from "./url-params";

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
  const updateRequestParams = useAppStore((s) => s.updateRequestParams);
  const activeRequestPanel = useAppStore((s) => s.activeRequestPanel);
  const setActiveRequestPanel = useAppStore((s) => s.setActiveRequestPanel);

  // URL bar shows path + query merged (Postman-style sync). While the input
  // is focused we keep a local draft so re-serialization can't move the
  // caret; the parsed result commits on blur/Enter.
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const hadQueryOnFocus = useRef(false);

  const environments = useAppStore((s) => s.environments);
  const activeEnvironmentId = useAppStore((s) => s.activeEnvironmentId);
  const collections = useAppStore((s) => s.collections);

  const request = requests[tabId];

  // Variable names for `{{…}}` Tab-completion in the URL bar.
  const variableNames = useMemo(() => {
    const env = environments.find((e) => e.id === activeEnvironmentId);
    const collection = findCollectionOfRequest(collections, request?.id ?? "");
    return new Set<string>([
      ...(env?.variables ?? []).map((v) => v.key),
      ...(collection?.variables ?? []).map((v) => v.key),
    ]);
  }, [environments, activeEnvironmentId, collections, request?.id]);

  const urlSuggestions = useCallback(
    (raw: string): Suggestion[] => {
      const t = raw.trim();
      if (!t) return [];
      const out: Suggestion[] = [];
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) {
        out.push({ label: `https://${t}`, insert: `https://${t}`, hint: "protocol" });
        out.push({ label: `http://${t}`, insert: `http://${t}`, hint: "protocol" });
      }
      const host = t.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "").split(/[/?#]/)[0];
      if (host && !host.includes(".") && !host.startsWith("{{")) {
        for (const tld of [".com", ".dev", ".io"]) {
          out.push({ label: `${t}${tld}`, insert: `${t}${tld}`, hint: "domain" });
        }
      }
      const partial = t.match(/\{\{([^}]*)$/);
      if (partial) {
        for (const name of variableNames) {
          if (name.startsWith(partial[1])) {
            out.push({
              label: `{{${name}}}`,
              insert: t.replace(/\{\{[^}]*$/, `{{${name}}}`),
              hint: "variable",
            });
          }
        }
      }
      return out;
    },
    [variableNames],
  );

  /** Commit an edited URL bar value: path → url, query → params table.
   * Removing the query clears params that existed when the field was focused
   * (true delete), while typing a fresh URL without `?` keeps the table. */
  const commitUrlValue = (value: string) => {
    const req = useAppStore.getState().requests[tabId];
    if (!req) return;
    const [path, query] = splitQuery(value.trim());
    if (path !== req.url) updateRequestUrl(tabId, path);
    if (query !== null) {
      updateRequestParams(tabId, parseQuery(query));
    } else if (hadQueryOnFocus.current) {
      updateRequestParams(tabId, []);
    }
  };

  if (!request) return null;
  const loading = isLoading[tabId] ?? false;

  const requestTabs: { id: ActivePanel; label: string; dot?: boolean; count?: number }[] = [
    { id: "params", label: "Params", dot: request.params.some((p) => p.enabled) },
    {
      id: "headers",
      label: "Headers",
      count: request.headers.filter((h) => h.enabled).length || undefined,
    },
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
              <option key={m} value={m} style={{ color: methodColor[m] }}>
                {m}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="kp-select-caret" />
        </div>

        <SuggestInput
          className="kp-url-input kp-mono"
          placeholder="https://api.example.com/endpoint"
          value={urlDraft ?? displayUrl(request.url, request.params)}
          suggestions={urlSuggestions}
          onChange={(v) => {
            if (urlDraft === null) {
              hadQueryOnFocus.current = splitQuery(displayUrl(request.url, request.params))[1] !== null;
            }
            setUrlDraft(v);
          }}
          onCommit={(v) => {
            setUrlDraft(null);
            commitUrlValue(v);
          }}
          onEnter={() => {
            const value = urlDraft ?? displayUrl(request.url, request.params);
            setUrlDraft(null);
            commitUrlValue(value);
            handleSend(tabId);
          }}
        />

        <div className="kp-send-group">
          <button
            type="button"
            className="kp-send-btn"
            title="Send (Ctrl+Enter)"
            disabled={loading || !request.url}
            onClick={() => handleSend(tabId)}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
          <DropdownMenu
            buttonClassName="kp-send-caret"
            buttonTitle="Send options"
            buttonLabel={<ChevronDown size={14} />}
            disabled={loading || !request.url}
            items={[
              {
                label: "Send (Ctrl+Enter)",
                icon: <Send size={12} />,
                onClick: () => handleSend(tabId),
              },
              {
                label: "Save & send (Ctrl+S)",
                icon: <Save size={12} />,
                onClick: () => {
                  useAppStore.getState().saveRequestTab(tabId);
                  handleSend(tabId);
                },
              },
            ]}
          />
        </div>
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
          <AuthEditor
            auth={request.auth}
            onChange={(a) => useAppStore.getState().updateRequestAuth(tabId, a)}
          />
        )}
        {activeRequestPanel === "body" && (
          <BodyEditor
            body={request.body}
            onChange={(b) => useAppStore.getState().updateRequestBody(tabId, b)}
          />
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
          <span className="kp-kv-menu">
            <MoreHorizontal size={13} />
          </span>
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
// One "Form" section covers both encodings: urlencoded by default, silently
// upgraded to multipart the moment a file is attached (Paw-style). The encoding
// toggle stays visible so text-only multipart remains reachable and imported
// multipart bodies round-trip without losing their type.
function BodyEditor({ body, onChange }: { body: BodyContent; onChange: (b: BodyContent) => void }) {
  const types: BodyContent["type"][] = [
    "none",
    "json",
    "text",
    "xml",
    "html",
    "form-urlencoded",
    "graphql",
  ];
  const label = (t: string) =>
    t === "form-urlencoded" ? "Form" : t.charAt(0).toUpperCase() + t.slice(1);
  const isForm = body.type === "form-urlencoded" || body.type === "multipart-form";

  const setEncoding = (t: "form-urlencoded" | "multipart-form") => {
    if (t === "form-urlencoded") {
      // Files can't survive urlencoded — file rows fall back to empty text.
      const cleaned = (body.formData ?? []).map((e) =>
        e.value instanceof File ? { ...e, value: "", type: "text" as const } : e,
      );
      onChange({ ...body, type: t, formData: cleaned });
    } else {
      onChange({ ...body, type: t });
    }
  };

  return (
    <div className="kp-body-editor">
      <div className="kp-seg-row">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className={clsx("kp-seg", (body.type === t || (t === "form-urlencoded" && isForm)) && "active")}
            onClick={() => !isForm && onChange({ ...body, type: t })}
          >
            {label(t)}
          </button>
        ))}
      </div>
      {isForm ? (
        <FormDataTable
          entries={body.formData ?? []}
          onChange={(formData) => onChange({ ...body, formData })}
          encoding={body.type}
          onEncodingChange={setEncoding}
        />
      ) : (
        body.type !== "none" && (
          <CodeEditor
            value={body.content ?? ""}
            onChange={(content) => onChange({ ...body, content })}
            language={body.type === "json" ? "json" : "text"}
            height="200px"
          />
        )
      )}
    </div>
  );
}

// ── Form Data Table (Form / Multipart bodies) ────────────────────────────────
// Value cell doubles as text input or file chip (Bruno-style): picking a file
// via the attach button turns the row into a file part AND silently upgrades
// the body encoding to multipart (files can't travel urlencoded).
function FormDataTable({
  entries,
  onChange,
  encoding,
  onEncodingChange,
}: {
  entries: FormDataEntry[];
  onChange: (entries: FormDataEntry[]) => void;
  encoding: "form-urlencoded" | "multipart-form";
  onEncodingChange: (t: "form-urlencoded" | "multipart-form") => void;
}) {
  const uid = useId();
  const [newKey, setNewKey] = useState("");
  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...entries, { key: newKey.trim(), value: "", type: "text", enabled: true }]);
      setNewKey("");
    }
  };
  const update = (i: number, changes: Partial<FormDataEntry>) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...changes } : e)));

  return (
    <div className="kp-kv">
      <div className="kp-form-head">
        <div className="kp-kv-title">Form Fields</div>
        <div className="kp-seg-row kp-encoding-seg" title="Body encoding for these fields">
          <button
            type="button"
            className={clsx("kp-seg", encoding === "form-urlencoded" && "active")}
            onClick={() => onEncodingChange("form-urlencoded")}
          >
            Urlencoded
          </button>
          <button
            type="button"
            className={clsx("kp-seg", encoding === "multipart-form" && "active")}
            onClick={() => onEncodingChange("multipart-form")}
          >
            Multipart
          </button>
        </div>
      </div>
      <div className="kp-kv-table kp-form-table">
        <div className="kp-kv-row kp-kv-head">
          <span />
          <span>Key</span>
          <span>Value</span>
          <span>File</span>
          <span className="kp-kv-menu">
            <MoreHorizontal size={13} />
          </span>
        </div>

        {entries.map((entry, i) => {
          const file = entry.value instanceof File ? entry.value : null;
          return (
            <div className="kp-kv-row" key={i}>
              <input
                type="checkbox"
                className="kp-checkbox"
                checked={entry.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />
              <input
                type="text"
                placeholder="Key"
                value={entry.key}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              {file ? (
                <span className="kp-file-chip" title={`${file.name} (${file.type || "unknown"})`}>
                  <Paperclip size={11} />
                  <span className="kp-truncate">
                    {file.name} ({formatBytes(file.size)})
                  </span>
                  <button
                    type="button"
                    className="kp-file-clear"
                    title="Remove file"
                    onClick={() => update(i, { value: "", type: "text" })}
                  >
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <input
                  type="text"
                  placeholder="Value"
                  value={typeof entry.value === "string" ? entry.value : ""}
                  onChange={(e) => update(i, { value: e.target.value, type: "text" })}
                />
              )}
              <input
                type="file"
                id={`${uid}-${i}`}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (encoding !== "multipart-form") onEncodingChange("multipart-form");
                    update(i, { value: f, type: "file" });
                  }
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="kp-file-btn"
                title="Select file"
                onClick={() => document.getElementById(`${uid}-${i}`)?.click()}
              >
                <Paperclip size={13} />
              </button>
              <span />
            </div>
          );
        })}

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
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Auth Editor ──────────────────────────────────────────────────────────────
// Moved to ../common/AuthEditor (shared with the collection Authorization subtab).

// ── Script Editor ────────────────────────────────────────────────────────────
type ScriptPhase = "pre" | "postResponse" | "test";

function ScriptEditor({ tabId }: { tabId: string }) {
  const requests = useAppStore((s) => s.requests);
  const updateRequest = useAppStore((s) => s.updateRequest);
  const request = requests[tabId];
  const [which, setWhich] = useState<ScriptPhase>("pre");
  if (!request) return null;
  const scripts = request.scripts ?? {};
  const value =
    which === "pre"
      ? (scripts.pre ?? "")
      : which === "test"
        ? (scripts.test ?? "")
        : (scripts.postResponse ?? "");

  return (
    <div className="kp-body-editor">
      <div className="kp-seg-row">
        <button
          type="button"
          className={clsx("kp-seg", which === "pre" && "active")}
          onClick={() => setWhich("pre")}
        >
          Pre-request
        </button>
        <button
          type="button"
          className={clsx("kp-seg", which === "postResponse" && "active")}
          onClick={() => setWhich("postResponse")}
        >
          Post-response
        </button>
        <button
          type="button"
          className={clsx("kp-seg", which === "test" && "active")}
          onClick={() => setWhich("test")}
        >
          Tests
        </button>
      </div>
      <p className="kp-hint">
        {which === "pre"
          ? "Runs before the request is sent. Use kp.env.set / kp.variables.set to prepare variables."
          : which === "postResponse"
            ? "Runs after the response, before tests. Use it for side effects — extract tokens, prep the next request."
            : "Runs after the response. Record checks with kp.test / pm.test."}
      </p>
      <CodeEditor
        value={value}
        onChange={(v) => updateRequest(tabId, { scripts: { ...scripts, [which]: v } })}
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
      <p>
        Quick assertions evaluated against <code className="kp-mono kp-accent-text">response</code>{" "}
        — must return <code className="kp-mono kp-accent-text">true</code> to pass:
      </p>
      <AssertionsEditor assertions={assertions} onChange={setAssertions} />
      <p>
        For full control, write test scripts in the <strong>Scripts</strong> tab —{" "}
        <code className="kp-mono kp-accent-text">kp.*</code>,{" "}
        <code className="kp-mono kp-accent-text">pm.*</code> and{" "}
        <code className="kp-mono kp-accent-text">bru.*</code> are all supported:
      </p>
      <pre className="kp-code-block kp-mono">{`kp.test("Status is 200", () => {
  kp.response.to.have.status(200);
});

pm.test("Response has data", () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property("data");
});

// response CODE is numeric; pm.response.status is the reason text
kp.test("fast enough", () => {
  kp.expect(kp.response.responseTime < 2000).to.eql(true);
});`}</pre>
    </div>
  );
}

// ── Request Settings ─────────────────────────────────────────────────────────
// Transport preferences (relay, timeout) are global — see the Settings page.
function RequestSettings() {
  return (
    <div className="kp-hint-block">
      <p>
        Transport settings are global and live in <strong>Settings</strong> — relay toggle, relay
        URL, theme, and the request timeout applied to every send.
      </p>
      <button
        type="button"
        className="kp-btn secondary"
        onClick={() => useAppStore.getState().openSettingsTab()}
      >
        Open Settings
      </button>
    </div>
  );
}

// ── Send ─────────────────────────────────────────────────────────────────────
export async function handleSend(tabId: string) {
  const store = useAppStore.getState();
  const request = store.requests[tabId];
  if (!request) return;

  store.setLoading(tabId, true);
  try {
    const { getTransport } = await import("@knockport/transport");
    const collection = findCollectionOfRequest(store.collections, request.id);
    let vars = buildVariableMap(store);
    if (collection?.scripts?.pre?.trim() || request.scripts?.pre?.trim()) {
      const { runPreScript } = await import("@knockport/engine");
      const opts = {
        environment: environmentVariableMap(store),
        collectionVariables: collectionVariablesMap(store),
        request,
      };
      if (collection?.scripts?.pre?.trim()) {
        vars = runPreScript(collection.scripts.pre, vars, opts).variables;
      }
      if (request.scripts?.pre?.trim()) {
        vars = runPreScript(request.scripts.pre, vars, opts).variables;
      }
    }
    const resolved = resolveRequest(request, vars, collection);
    const transport = getTransport({
      useRelay: store.useRelay,
      relayUrl: store.relayUrl,
      relayToken: store.relayToken,
    });
    // Enforce the global timeout via an abort signal (transports link it to
    // their own AbortController).
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), store.timeoutMs);
    let response;
    try {
      response = await transport.execute(resolved, { signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
    store.setResponse(tabId, response);

    // Script phases (Bruno ordering): post-response runs before tests. The
    // runner loop carries post-response variable mutations into the next
    // request; a single send has no follow-up so they are ephemeral.
    const postScript = [collection?.scripts?.postResponse, request.scripts?.postResponse]
      .filter((s) => s?.trim())
      .join("\n");
    let postSummary: TestRunSummary | null = null;
    if (postScript.trim()) {
      const { runPostResponseScript } = await import("@knockport/engine");
      const post = await runPostResponseScript(response, postScript, vars, {
        environment: environmentVariableMap(store),
        collectionVariables: collectionVariablesMap(store),
        request: resolved,
      });
      postSummary = post.summary;
    }

    // Run test scripts + assertions (interim TS runner; wasm engine in M3)
    // Collection-level scripts/assertions run before the request's own.
    const testScript = [collection?.scripts?.test, request.scripts?.test]
      .filter((s) => s?.trim())
      .join("\n");
    const assertions = [...(collection?.assertions ?? []), ...(request.assertions ?? [])];
    const hasTests = Boolean(testScript.trim() || assertions.length);
    if (hasTests || postSummary) {
      const { runTests, mergeTestSummaries } = await import("@knockport/engine");
      const summary = hasTests
        ? await runTests(response, {
            script: testScript || undefined,
            assertions,
            environment: environmentVariableMap(store),
            collectionVariables: collectionVariablesMap(store),
            request: resolved,
          })
        : null;
      if (postSummary && summary) {
        store.setTestResults(tabId, mergeTestSummaries(postSummary, summary));
      } else {
        store.setTestResults(tabId, summary ?? postSummary);
      }
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
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    store.setTestResults(tabId, null);
    store.setResponse(tabId, {
      id: crypto.randomUUID(),
      requestId: request.id,
      status: 0,
      statusText: timedOut
        ? `Request timed out after ${store.timeoutMs} ms`
        : err instanceof Error
          ? err.message
          : "Request failed",
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

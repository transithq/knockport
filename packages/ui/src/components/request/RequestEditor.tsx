import {
  type Assertion,
  type BodyContent,
  collectPromptVariableNames,
  collectRequestPromptVariables,
  ensureOAuth2AndAttach,
  type FormDataEntry,
  getPredefinedVariableNames,
  HTTP_METHODS,
  type HttpMethod,
  type KeyValuePair,
  type RequestSettings,
  scrubRequestSecrets,
  secretVariableValues,
  withPromptAnswers,
} from "@knockport/core";
import type { TestRunSummary } from "@knockport/engine";
import { clsx } from "clsx";
import { ChevronDown, Code2, Loader2, MoreHorizontal, Paperclip, Pencil, Save, Send, X } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { type ActivePanel, useAppStore } from "../../store/app-store";
import { attachCookieJar } from "../../store/cookie-jar";
import { promptForVariables } from "../../store/prompts";
import {
  buildVariableMap,
  collectionVariablesMap,
  effectiveAssertions,
  effectivePostScripts,
  effectivePreScripts,
  effectiveTestScripts,
  environmentName,
  environmentVariableMap,
  findCollectionOfRequest,
  folderVariablesFor,
  globalsVariableMap,
  resolveRequest,
} from "../../store/variables";
import { AssertionsEditor } from "../common/AssertionsEditor";
import { AuthEditor } from "../common/AuthEditor";
import { CodeEditor } from "../common/CodeEditor";
import { type Suggestion, SuggestInput } from "../common/SuggestInput";
import { DropdownMenu } from "../common/DropdownMenu";
import { displayUrl, parseQuery, splitQuery } from "./url-params";
import { VarsPanel } from "./VarsPanel";

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
    const globals = environments.find((e) => e.isDefault);
    const collection = findCollectionOfRequest(collections, request?.id ?? "");
    const folderVars = collection ? folderVariablesFor(collection, request?.id ?? "") : [];
    return new Set<string>([
      ...(globals?.variables ?? []).map((v) => v.key),
      ...(env?.variables ?? []).map((v) => v.key),
      ...(collection?.variables ?? []).map((v) => v.key),
      ...folderVars.map((v) => v.key),
      ...(request?.requestVars ?? []).map((v) => v.key),
      ...getPredefinedVariableNames(),
    ]);
  }, [environments, activeEnvironmentId, collections, request?.id, request?.requestVars]);

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

  const reqVarCount = (request.requestVars ?? []).filter((v) => v.enabled !== false).length;
  const resVarCount = (request.responseVars ?? []).filter((v) => v.enabled !== false).length;

  const requestTabs: { id: ActivePanel; label: string; dot?: boolean; count?: number }[] = [
    { id: "params", label: "Params", dot: request.params.some((p) => p.enabled) },
    {
      id: "headers",
      label: "Headers",
      count: request.headers.filter((h) => h.enabled).length || undefined,
    },
    { id: "auth", label: "Authorization" },
    { id: "body", label: "Body" },
    {
      id: "vars",
      label: "Variables",
      count: reqVarCount + resVarCount || undefined,
    },
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
        {activeRequestPanel === "vars" && <VarsPanel tabId={tabId} />}
        {activeRequestPanel === "scripts" && <ScriptEditor tabId={tabId} />}
        {activeRequestPanel === "tests" && <TestsPanel tabId={tabId} />}
        {activeRequestPanel === "settings" && <RequestSettingsPane tabId={tabId} />}
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
    "binary",
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
          encoding={body.type === "multipart-form" ? "multipart-form" : "form-urlencoded"}
          onEncodingChange={setEncoding}
        />
      ) : body.type === "binary" ? (
        <BinaryBodyEditor body={body} onChange={onChange} />
      ) : body.type === "graphql" ? (
        <div className="kp-graphql-editor">
          <div className="kp-graphql-pane">
            <div className="kp-kv-title">Query</div>
            <CodeEditor
              value={body.graphql?.query ?? ""}
              onChange={(query) =>
                onChange({ ...body, graphql: { ...(body.graphql ?? {}), query } })
              }
              language="text"
              height="160px"
            />
          </div>
          <div className="kp-graphql-pane">
            <div className="kp-kv-title">Variables (JSON)</div>
            <CodeEditor
              value={body.graphql?.variables ?? ""}
              onChange={(variables) =>
                onChange({
                  ...body,
                  graphql: { query: body.graphql?.query ?? "", variables },
                })
              }
              language="json"
              height="160px"
            />
          </div>
        </div>
      ) : (
        body.type !== "none" && (
          <>
            {body.type === "xml" && (
              <button
                type="button"
                className="kp-lang-btn"
                title="Wrap the content in a SOAP 1.1 envelope (or insert a skeleton)"
                onClick={() => onChange({ ...body, content: soapEnvelope(body.content ?? "") })}
              >
                Insert SOAP envelope
              </button>
            )}
            <CodeEditor
              value={body.content ?? ""}
              onChange={(content) => onChange({ ...body, content })}
              language={body.type === "json" ? "json" : "text"}
              height="200px"
            />
          </>
        )
      )}
    </div>
  );
}

// ── Binary Body Editor (E1) ──────────────────────────────────────────────────
// Single in-memory file (Hoppscotch parity). Sends as application/octet-stream
// (or the file's own type) through DirectTransport/relay. The File handle is
// never persisted — disk/export writes a `[file]` marker and the picker resets.
function BinaryBodyEditor({
  body,
  onChange,
}: {
  body: BodyContent;
  onChange: (b: BodyContent) => void;
}) {
  const uid = useId();
  const file = body.file ?? null;
  return (
    <div className="kp-binary-editor">
      <div className="kp-hint">
        Send a single file as the request body with an{" "}
        <code className="kp-mono">application/octet-stream</code> content-type.
      </div>
      {file ? (
        <div className="kp-file-chip kp-binary-chip" title={`${file.name} (${file.type || "unknown type"})`}>
          <Paperclip size={12} />
          <span className="kp-truncate">
            {file.name} ({formatBytes(file.size)})
            {file.type ? ` · ${file.type}` : ""}
          </span>
          <button
            type="button"
            className="kp-file-clear"
            title="Remove file"
            onClick={() => onChange({ ...body, file: undefined, content: undefined })}
          >
            <X size={11} />
          </button>
        </div>
      ) : body.content ? (
        <div className="kp-hint kp-binary-marker">
          <code className="kp-mono">{body.content}</code>
          <span> — pick a file to send it as the binary body.</span>
        </div>
      ) : null}
      <input
        type="file"
        id={uid}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChange({ ...body, file: f });
          e.target.value = "";
        }}
      />
      <div className="kp-binary-actions">
        <button
          type="button"
          className="kp-btn small"
          title="Choose a file to send"
          onClick={() => document.getElementById(uid)?.click()}
        >
          <Paperclip size={13} /> {file ? "Replace file" : "Choose file"}
        </button>
        {file && (
          <button
            type="button"
            className="kp-btn small danger"
            onClick={() => onChange({ ...body, file: undefined, content: undefined })}
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const isMultipart = encoding === "multipart-form";
  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...entries, { key: newKey.trim(), value: "", type: "text", enabled: true }]);
      setNewKey("");
    }
  };
  const update = (i: number, changes: Partial<FormDataEntry>) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...changes } : e)));

  const openBulk = () => {
    setBulkText(serializeBulkText(entries));
    setBulkOpen(true);
  };
  const commitBulk = () => {
    const parsed = parseBulkText(bulkText);
    // File parts can't round-trip through plain text — keep them in place and
    // fill text slots from the parsed lines (Hoppscotch behavior).
    const next: FormDataEntry[] = [];
    let p = 0;
    for (const e of entries) {
      if (e.type === "text") {
        if (p < parsed.length) next.push(parsed[p++]);
      } else {
        next.push(e);
      }
    }
    while (p < parsed.length) next.push(parsed[p++]);
    onChange(next);
    setBulkOpen(false);
  };

  return (
    <div className="kp-kv">
      <div className="kp-form-head">
        <div className="kp-kv-title">Form Fields</div>
        <button
          type="button"
          className={clsx("kp-icon-btn", bulkOpen && "active")}
          title="Bulk edit as text (key: value per line, // disables a line)"
          onClick={bulkOpen ? commitBulk : openBulk}
        >
          <Pencil size={13} />
        </button>
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
      {bulkOpen ? (
        <div className="kp-bulk-editor">
          <textarea
            className="kp-code-input kp-mono"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            spellCheck={false}
            placeholder={"key: value\n//disabled-key: value"}
          />
          <div className="kp-bulk-foot">
            <span className="kp-hint">
              {entries.filter((e) => e.type === "file").length} file part(s) kept — not
              editable as text.
            </span>
            <button type="button" className="kp-btn small primary" onClick={commitBulk}>
              Done
            </button>
          </div>
        </div>
      ) : (
      <div className="kp-kv-table kp-form-table">
        <div className="kp-kv-row kp-kv-head">
          <span />
          <span>Key</span>
          <span>Value</span>
          <span>File</span>
          {isMultipart && <span>Type</span>}
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
              {isMultipart && (
                <input
                  type="text"
                  placeholder="Auto"
                  title="Per-part Content-Type (empty = auto)"
                  value={entry.contentType ?? ""}
                  onChange={(e) => update(i, { contentType: e.target.value })}
                />
              )}
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
          {isMultipart && <input type="text" readOnly />}
          <span />
        </div>
      </div>
      )}
    </div>
  );
}

// ── Form-data bulk edit format (E2) ──────────────────────────────────────────
// Bruno-style `key:value` per line; `//` prefix disables a line. Only text
// entries participate — file parts are preserved separately.
function serializeBulkText(entries: FormDataEntry[]): string {
  return entries
    .filter((e) => e.type === "text")
    .map((e) => `${e.enabled ? "" : "//"}${e.key}:${e.value}`)
    .join("\n");
}

function parseBulkText(text: string): FormDataEntry[] {
  const out: FormDataEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let enabled = true;
    let body = line;
    if (body.startsWith("//")) {
      enabled = false;
      body = body.slice(2);
    }
    const idx = body.indexOf(":");
    if (idx === -1) continue;
    out.push({
      key: body.slice(0, idx).trim(),
      value: body.slice(idx + 1).trim(),
      type: "text",
      enabled,
    });
  }
  return out;
}

/** SOAP 1.1 envelope: wraps existing content as the Body payload, or
 * produces a skeleton when the editor is empty. Pair with a text/xml
 * Content-Type header (user-set — SOAPAction too for SOAP 1.1). */
function soapEnvelope(content: string): string {
  const inner = content.trim();
  const body = inner
    ? `    <!-- wrapped payload -->
    ${inner}`
    : `    <!-- your payload here -->`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"',
    '               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '               xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <soap:Header />',
    '  <soap:Body>',
    body,
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join("\n");
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
      <div className="kp-scripts-toolbar">
        <button
          type="button"
          className="kp-btn"
          onClick={() => useAppStore.getState().setInheritScriptsRequest(tabId)}
          title="Collection + folder scripts that also run for this request"
        >
          View inherited scripts
        </button>
      </div>
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
        — must return <code className="kp-mono kp-accent-text">true</code> to pass. Tab for
        operator templates (eq/contains/between/isJson/… — Bruno's full set):
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

// ── Request Settings Pane (E4) ───────────────────────────────────────────────
// Bruno `RequestPane/Settings` parity (B§9 DEFAULT_SETTINGS): URL encoding,
// redirect behavior, and a per-request timeout override. Defaults match
// Bruno: encodeUrl off, followRedirects on, maxRedirects 5, timeout inherited
// (global preference), forwardAuthorizationHeader on.
const DEFAULT_SETTINGS = {
  encodeUrl: false,
  followRedirects: true,
  maxRedirects: 5,
  timeout: "inherit" as number | "inherit",
  forwardAuthorizationHeader: true,
};

/** Pane-local settings view: timeout may carry the "inherit" sentinel. */
type SettingsWithInherit = Omit<RequestSettings, "timeout"> & { timeout?: number | "inherit" };

function RequestSettingsPane({ tabId }: { tabId: string }) {
  const requests = useAppStore((s) => s.requests);
  const updateRequestSettings = useAppStore((s) => s.updateRequestSettings);
  const request = requests[tabId];
  if (!request) return null;
  const settings = {
    ...DEFAULT_SETTINGS,
    ...request.settings,
  } as SettingsWithInherit;
  const set = (patch: Partial<RequestSettings>) => {
    const next: SettingsWithInherit = { ...settings, ...patch };
    if (next.timeout === "inherit") delete next.timeout;
    updateRequestSettings(tabId, next as RequestSettings);
  };

  return (
    <div className="kp-req-settings">
      <p className="kp-hint">
        Per-request behavior overrides. Timeout "inherit" falls back to the global Settings page
        value.
      </p>

      <div className="kp-setting-row">
        <label>URL Encoding</label>
        <input
          type="checkbox"
          className="kp-checkbox"
          checked={settings.encodeUrl}
          onChange={(e) => set({ encodeUrl: e.target.checked })}
        />
        <p className="kp-hint">Automatically encode query parameters in the URL</p>
      </div>

      <div className="kp-setting-row">
        <label>Follow Redirects</label>
        <input
          type="checkbox"
          className="kp-checkbox"
          checked={settings.followRedirects}
          onChange={(e) => set({ followRedirects: e.target.checked })}
        />
        <p className="kp-hint">Follow HTTP redirects automatically</p>
      </div>

      <div className="kp-setting-row">
        <label>Max Redirects</label>
        <input
          type="number"
          className="kp-num-input"
          min={0}
          value={settings.maxRedirects}
          onChange={(e) =>
            set({
              maxRedirects:
                e.target.value === "" ? undefined : Math.max(0, Number.parseInt(e.target.value, 10)),
            })
          }
        />
        <p className="kp-hint">Ceiling on redirects to follow (relay caps at 5)</p>
      </div>

      <div className="kp-setting-row">
        <label>Timeout (ms)</label>
        <select
          className="kp-select"
          style={{ width: 110 }}
          value={settings.timeout === "inherit" ? "inherit" : "custom"}
          onChange={(e) => set({ timeout: e.target.value === "inherit" ? undefined : 0 })}
        >
          <option value="inherit">Inherit</option>
          <option value="custom">Custom</option>
        </select>
        {settings.timeout !== "inherit" && (
          <input
            type="number"
            className="kp-num-input"
            min={1}
            step={1000}
            value={settings.timeout}
            onChange={(e) =>
              set({ timeout: e.target.value === "" ? undefined : Math.max(1, Number.parseInt(e.target.value, 10)) })
            }
          />
        )}
        <p className="kp-hint">Maximum time to wait before aborting the request</p>
      </div>

      <div className="kp-setting-row">
        <label>Forward Authorization on Redirect</label>
        <input
          type="checkbox"
          className="kp-checkbox"
          checked={settings.forwardAuthorizationHeader}
          onChange={(e) => set({ forwardAuthorizationHeader: e.target.checked })}
        />
        <p className="kp-hint">
          Reserved — the relay always strips credentials on cross-origin redirects (secure default)
        </p>
      </div>
    </div>
  );
}

// ── Request Settings ─────────────────────────────────────────────────────────
// Transport preferences (relay, timeout) are global — see the Settings page.
// ── Send ─────────────────────────────────────────────────────────────────────
export async function handleSend(tabId: string) {
  const store = useAppStore.getState();
  const request = store.requests[tabId];
  if (!request) return;

    store.setLoading(tabId, true);
  let effectiveTimeout = store.timeoutMs;
  try {
    const { getTransport, optionsForRequest } = await import("@knockport/transport");
    const collection = findCollectionOfRequest(store.collections, request.id);
    // Folder-inherited variables (A2): the request's folder chain, merged
    // over the collection/env layers and under request variables.
    const folderVars = collection ? folderVariablesFor(collection, request.id) : undefined;
    const preScripts = collection ? effectivePreScripts(request, collection) : request.scripts?.pre?.trim() ? [request.scripts.pre] : [];
    const postScripts = collection ? effectivePostScripts(request, collection) : request.scripts?.postResponse?.trim() ? [request.scripts.postResponse] : [];
    const testScripts = collection ? effectiveTestScripts(request, collection) : request.scripts?.test?.trim() ? [request.scripts.test] : [];
    const assertions = collection ? effectiveAssertions(request, collection) : (request.assertions ?? []);
    // Prompt variables (A5): `{{$prompt.name}}` placeholders (scripts of the
    // collection, folder chain + request) pause the send for an answer each,
    // merged into the map before pre-request scripts. Cancelling aborts.
    const answers = await promptForVariables([
      ...new Set([
        ...collectRequestPromptVariables(request),
        ...collectPromptVariableNames(...preScripts, ...postScripts, ...testScripts),
      ]),
    ]);
    if (answers === null) {
      store.setLoading(tabId, false);
      return;
    }
    let vars = withPromptAnswers(
      buildVariableMap(store, undefined, {
        folderVars,
        requestVars: request.requestVars,
      }),
      answers,
    );
    if (preScripts.length) {
      const { runPreScript } = await import("@knockport/engine");
      const opts = {
        environment: environmentVariableMap(store),
        collectionVariables: collectionVariablesMap(store),
        globals: globalsVariableMap(store),
        request,
        envName: environmentName(store),
        collectionName: collection?.name,
        cookieJar: useAppStore.getState().cookieJar,
      };
      for (const script of preScripts) {
        vars = runPreScript(script, vars, opts).variables;
      }
    }
    const resolved = resolveRequest(request, vars, collection);
    // G1 cookie jar: attach stored cookies for this URL (an explicit Cookie
    // header on the request wins). Execution uses the cookie-attached copy;
    // history keeps the resolved request (the jar is dynamic session state).
    const cookieAttached = attachCookieJar(resolved, useAppStore.getState().cookieJar);
    const transport = getTransport({
      useRelay: store.useRelay,
      relayUrl: store.relayUrl,
      relayToken: store.relayToken,
    });
    // OAuth2 (B1): attach the stored token; refresh first when expired. The
    // refresh write-back lands on the tab copy; it persists on the next save.
    if (cookieAttached.auth.type === "oauth2" && cookieAttached.auth.oauth2?.accessToken) {
      const oauth = await ensureOAuth2AndAttach(cookieAttached, cookieAttached.auth, transport, undefined);
      if (oauth.refreshed && oauth.stored) {
        useAppStore.getState().updateRequestAuth(tabId, cookieAttached.auth);
      }
    }
    // E4 per-request settings: followRedirects/maxRedirects/encodeUrl resolve
    // into the transport options; a request-level timeout override beats the
    // global preference (and drives the abort signal below).
    const options = optionsForRequest(cookieAttached, { defaultTimeoutMs: store.timeoutMs });
    effectiveTimeout = options.timeout ?? store.timeoutMs;
    // Enforce the timeout via an abort signal (transports link it to their
    // own AbortController). The relay also gets timeout_ms on the wire.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), options.timeout ?? store.timeoutMs);
    let response;
    try {
      response = await transport.execute(cookieAttached, { signal: abort.signal, ...options });
    } finally {
      clearTimeout(timer);
    }
    store.setResponse(tabId, response);
    store.captureResponseCookies(response);

    const summaries: TestRunSummary[] = [];
    // Response variables (A1 res side): each enabled variable's JS expression
    // is evaluated against the response; the results land in the runtime
    // scope for post-response/test scripts and the runner's next request.
    let scriptVars = vars;
    if (request.responseVars?.length) {
      const { runPostResponseVars } = await import("@knockport/engine");
      const resVars = runPostResponseVars(response, request.responseVars, vars, {
        environment: environmentVariableMap(store),
        collectionVariables: collectionVariablesMap(store),
        globals: globalsVariableMap(store),
        request: resolved,
        envName: environmentName(store),
        collectionName: collection?.name,
        cookieJar: useAppStore.getState().cookieJar,
      });
      scriptVars = resVars.vars;
      store.setExtractedVars(tabId, scriptVars, request.responseVars.map((v) => v.key));
      const errors = Object.entries(resVars.errors);
      if (errors.length) {
        summaries.push({
          tests: errors.map(([key, message]) => ({
            name: `vars.post-response: ${key}`,
            passed: false,
            message,
          })),
          passed: 0,
          failed: errors.length,
          duration: 0,
        });
      }
    } else {
      store.setExtractedVars(tabId, null);
    }

    // Script phases (Bruno ordering): post-response runs before tests; the
    // effective lists already chain collection → folders → request, so a
    // folder's post-response script runs after the collection's and before
    // the request's own.
    const postScript = postScripts.join("\n");
    if (postScript.trim()) {
      const { runPostResponseScript } = await import("@knockport/engine");
      const post = await runPostResponseScript(response, postScript, scriptVars, {
        environment: environmentVariableMap(store),
        collectionVariables: collectionVariablesMap(store),
        globals: globalsVariableMap(store),
        request: resolved,
        envName: environmentName(store),
        collectionName: collection?.name,
        cookieJar: useAppStore.getState().cookieJar,
      });
      summaries.push(post.summary);
      scriptVars = post.variables;
    }

    // Run test scripts + assertions (interim TS runner; wasm engine in M3)
    const testScript = testScripts.join("\n");
    if (testScript.trim() || assertions.length) {
      const { runTests } = await import("@knockport/engine");
      summaries.push(
        await runTests(response, {
          script: testScript || undefined,
          assertions,
          environment: environmentVariableMap(store),
          collectionVariables: collectionVariablesMap(store),
          globals: globalsVariableMap(store),
          variables: scriptVars,
          request: resolved,
          envName: environmentName(store),
          collectionName: collection?.name,
          cookieJar: useAppStore.getState().cookieJar,
        }),
      );
    }
    const { mergeTestSummaries } = await import("@knockport/engine");
    store.setTestResults(
      tabId,
      summaries.length ? summaries.reduce(mergeTestSummaries) : null,
    );
    // C8: persist any bru.cookies.* mutations made by scripts (the jar is
    // mutated in place by the engine) so they survive and the manager shows them.
    store.syncCookieJar();

    // Scrub secret-typed variable values out of the resolved request before
    // it reaches history (the auth headers/params may carry live credentials).
    const activeEnv = store.environments.find((e) => e.id === store.activeEnvironmentId);
    const secretValues = secretVariableValues(
      activeEnv?.variables ?? [],
      ...store.collections.map((c) => c.variables ?? []),
    );
    store.addHistoryEntry({
      id: crypto.randomUUID(),
      request: scrubRequestSecrets(resolved, secretValues),
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
        ? `Request timed out after ${effectiveTimeout} ms`
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

import { createId } from "@knockport/core";
import { Braces, FileCode2, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { parse as parseYaml } from "yaml";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";

// ── APIs workspace tab ───────────────────────────────────────────────────────
// Postman-style API section, lightweight: import OpenAPI/Swagger specs (paste
// or file), browse their operations, and generate KnockPort requests (single
// endpoint or the whole spec) into a collection. Specs persist in
// localStorage — no schema migration needed.

export interface ApiSpecSummary {
  id: string;
  name: string;
  version: string;
  servers: string[];
  operations: ApiOperation[];
  raw: string;
}

export interface ApiOperation {
  method: string;
  path: string;
  summary?: string;
  operationId?: string;
}

const SPECS_KEY = "kp-api-specs";
const SPEC_MAX = 2 * 1024 * 1024; // 2 MB per spec

function loadSpecs(): ApiSpecSummary[] {
  try {
    const raw = localStorage.getItem(SPECS_KEY);
    return raw ? (JSON.parse(raw) as ApiSpecSummary[]) : [];
  } catch {
    return [];
  }
}

function saveSpecs(specs: ApiSpecSummary[]) {
  try {
    localStorage.setItem(SPECS_KEY, JSON.stringify(specs));
  } catch {
    // quota exceeded — drop oldest specs and retry once
    try {
      localStorage.setItem(SPECS_KEY, JSON.stringify(specs.slice(-3)));
    } catch {
      // give up silently
    }
  }
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Minimal OpenAPI/Swagger reader: title, version, servers, path operations.
 * Tolerates both JSON and YAML, v2 (basePath) and v3 (servers). */
export function parseSpec(raw: string): { name: string; version: string; servers: string[]; operations: ApiOperation[] } {
  const doc = parseYaml(raw) as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw new Error("Could not parse the spec (expected JSON or YAML).");
  const paths = doc.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths || typeof paths !== "object") throw new Error("The spec has no `paths` object — not an OpenAPI/Swagger document.");

  const info = (doc.info as Record<string, string> | undefined) ?? {};
  const servers: string[] = [];
  if (Array.isArray(doc.servers)) {
    for (const s of doc.servers as { url?: string }[]) if (s?.url) servers.push(s.url);
  }
  if (typeof doc.basePath === "string" && doc.basePath) servers.push(doc.basePath);
  if (typeof doc.host === "string" && doc.host) servers.push(`https://${doc.host}${doc.basePath ?? ""}`);

  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      const o = (op ?? {}) as Record<string, string>;
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: typeof o.summary === "string" ? o.summary : undefined,
        operationId: typeof o.operationId === "string" ? o.operationId : undefined,
      });
    }
  }
  if (operations.length === 0) throw new Error("No operations found under `paths`.");
  return {
    name: info.title || "Untitled API",
    version: info.version || "",
    servers,
    operations,
  };
}

/** Build a KnockPort request URL from a spec operation. */
function opUrl(spec: ApiSpecSummary, op: ApiOperation): string {
  const base = spec.servers[0] ?? "";
  const trimmed = base.replace(/\/+$/, "");
  const path = op.path.startsWith("/") ? op.path : `/${op.path}`;
  return `${trimmed}${path}`;
}

export function ApiTab() {
  const specs = useMemo(loadSpecs, []);
  const [specList, setSpecList] = useState<ApiSpecSummary[]>(specs);
  const [selectedId, setSelectedId] = useState<string | null>(specs[0]?.id ?? null);
  const [importing, setImporting] = useState(specs.length === 0);
  const [importName, setImportName] = useState("");
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const persist = (next: ApiSpecSummary[]) => {
    setSpecList(next);
    saveSpecs(next);
    if (selectedId && !next.some((s) => s.id === selectedId)) {
      setSelectedId(next[0]?.id ?? null);
    }
  };

  const selected = specList.find((s) => s.id === selectedId) ?? null;

  const doImport = (raw: string, name?: string) => {
    setError(null);
    if (raw.length > SPEC_MAX) {
      setError("Spec is larger than 2 MB.");
      return;
    }
    try {
      const parsed = parseSpec(raw);
      const spec: ApiSpecSummary = {
        id: createId("spec"),
        name: name?.trim() || parsed.name,
        version: parsed.version,
        servers: parsed.servers,
        operations: parsed.operations,
        raw,
      };
      const next = [...specList, spec];
      persist(next);
      setSelectedId(spec.id);
      setImporting(false);
      setImportName("");
      setImportText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse the spec.");
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => doImport(String(reader.result ?? ""), file.name.replace(/\.(json|ya?ml)$/i, ""));
    reader.readAsText(file);
  };

  const addRequestToCollection = (op: ApiOperation) => {
    if (!selected) return;
    const store = useAppStore.getState();
    const req = {
      id: createId("req"),
      name: op.summary || op.operationId || `${op.method} ${op.path}`,
      method: op.method,
      url: opUrl(selected, op),
      headers: [],
      params: [],
      body: { type: "none" },
      auth: { type: "none" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    } as const;
    // Reuse the first collection; create one when none exists.
    const target = store.collections[0];
    if (!target) {
      store.addCollection({
        id: createId("col"),
        name: selected.name,
        variables: [],
        folders: [],
        requests: [req],
        order: [req.id],
        auth: { type: "none" },
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
    } else {
      store.addExistingRequest(target.id, null, req);
    }
    store.openTab(req);
  };

  const importAllToCollection = () => {
    if (!selected) return;
    const store = useAppStore.getState();
    const requests = selected.operations.map((op) => ({
      id: createId("req"),
      name: op.summary || op.operationId || `${op.method} ${op.path}`,
      method: op.method,
      url: opUrl(selected, op),
      headers: [],
      params: [],
      body: { type: "none" },
      auth: { type: "none" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    }));
    store.addCollection({
      id: createId("col"),
      name: `${selected.name}${selected.version ? ` (${selected.version})` : ""}`,
      variables: [],
      folders: [],
      requests,
      order: requests.map((r) => r.id),
      auth: { type: "none" },
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
  };

  return (
    <div className="kp-settings-page kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <Braces size={17} />
        </span>
        <h1 className="kp-settings-title">APIs</h1>
        <button type="button" className="kp-btn primary" onClick={() => setImporting(true)}>
          <Plus size={14} /> Import Spec
        </button>
      </div>
      <p className="kp-hint">
        Import OpenAPI / Swagger definitions, browse their endpoints, and generate requests from them.
      </p>

      {importing && (
        <div className="kp-settings-section">
          <h2>Import OpenAPI / Swagger</h2>
          <div className="kp-setting-row">
            <label>Name</label>
            <input
              type="text"
              className="kp-text-input"
              style={{ flex: 1 }}
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="Optional — taken from info.title when empty"
            />
          </div>
          <div className="kp-setting-row kp-api-import-row">
            <label>Spec (JSON or YAML)</label>
            <textarea
              className="kp-text-input kp-mono kp-api-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'Paste the spec here, or use the file button.\n{\n  "openapi": "3.1.0",\n  "info": { "title": "Pets", "version": "1.0" },\n  "paths": { … }\n}'}
              spellCheck={false}
            />
          </div>
          <div className="kp-setting-row kp-api-import-actions">
            <label className="kp-btn secondary kp-file-drop-btn">
              <Upload size={13} /> Choose file
              <input
                type="file"
                accept=".json,.yaml,.yml,application/json,text/yaml"
                hidden
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <span style={{ flex: 1 }} />
            <button type="button" className="kp-btn secondary" onClick={() => { setImporting(false); setError(null); }}>
              Cancel
            </button>
            <button type="button" className="kp-btn primary" onClick={() => doImport(importText, importName)} disabled={!importText.trim()}>
              Import
            </button>
          </div>
          {error && <p className="kp-api-error">{error}</p>}
        </div>
      )}

      {specList.length === 0 && !importing && (
        <p className="kp-hint">No API specs yet — import one to see its endpoints here.</p>
      )}

      <div className="kp-api-list">
        {specList.map((spec) => (
          <button
            key={spec.id}
            type="button"
            className={clsx("kp-api-spec-card", spec.id === selectedId && "active")}
            onClick={() => setSelectedId(spec.id)}
          >
            <FileCode2 size={15} />
            <span className="kp-api-spec-name kp-truncate">{spec.name}</span>
            {spec.version && <span className="kp-chip">v{spec.version}</span>}
            <span className="kp-chip">{spec.operations.length} endpoints</span>
            <span
              className="kp-icon-btn"
              title="Delete spec"
              onClick={(e) => {
                e.stopPropagation();
                persist(specList.filter((s) => s.id !== spec.id));
              }}
            >
              <Trash2 size={13} />
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="kp-settings-section">
          <div className="kp-api-spec-head">
            <h2>{selected.name}</h2>
            <button type="button" className="kp-btn primary" onClick={importAllToCollection}>
              <Plus size={13} /> Create collection from spec
            </button>
          </div>
          {selected.servers.length > 0 && (
            <p className="kp-hint kp-mono">servers: {selected.servers.join(" · ")}</p>
          )}
          <div className="kp-kv-table">
            {selected.operations.map((op, i) => (
              <div className="kp-kv-row kp-api-op-row" key={i}>
                <span
                  className="kp-method-tag"
                  style={{ color: `var(--kp-method-${op.method.toLowerCase()})` }}
                >
                  {op.method}
                </span>
                <span className="kp-mono kp-api-op-path">{op.path}</span>
                <span className="kp-api-op-summary kp-truncate">{op.summary ?? op.operationId ?? ""}</span>
                <button type="button" className="kp-btn secondary" onClick={() => addRequestToCollection(op)}>
                  Add request
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

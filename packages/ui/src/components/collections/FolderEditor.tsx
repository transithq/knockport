import type {
  Assertion,
  Collection,
  Folder,
  FolderVariable,
  KeyValuePair,
  RequestScripts,
} from "@knockport/core";
import { clsx } from "clsx";
import { FolderCog, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { AssertionsEditor } from "../common/AssertionsEditor";
import { AuthEditor } from "../common/AuthEditor";
import { CodeEditor } from "../common/CodeEditor";
import { PlainVarsTable } from "../common/PlainVarsTable";

type FolderSubTab = "overview" | "headers" | "auth" | "scripts" | "tests" | "variables";
type FolderScriptPhase = "pre" | "postResponse";

function findFolder(folders: Folder[], folderId: string): Folder | undefined {
  for (const f of folders) {
    if (f.id === folderId) return f;
    const nested = findFolder(f.folders, folderId);
    if (nested) return nested;
  }
  return undefined;
}

/** Breadcrumb path from the collection root to a folder (inclusive). */
function folderPath(folders: Folder[], folderId: string, trail: string[] = []): string[] | undefined {
  for (const f of folders) {
    const here = [...trail, f.name];
    if (f.id === folderId) return here;
    const deeper = folderPath(f.folders, folderId, here);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * Full-area folder editor tab (Bruno folderRootSchema): docs, headers, auth,
 * scripts, tests, variables. Every section inherits into the folder's
 * requests at execution time (J1).
 */
export function FolderEditor({ collectionId, folderId }: { collectionId: string; folderId: string }) {
  const collections = useAppStore((s) => s.collections);
  const updateFolder = useAppStore((s) => s.updateFolder);
  const [sub, setSub] = useState<FolderSubTab>("overview");
  const [which, setWhich] = useState<FolderScriptPhase>("pre");

  const collection: Collection | undefined = collections.find((c) => c.id === collectionId);
  const folder = collection ? findFolder(collection.folders, folderId) : undefined;
  if (!collection || !folder) return null;

  const set = (changes: Partial<Folder>) => updateFolder(collection.id, folder.id, changes);
  const path = folderPath(collection.folders, folderId) ?? [folder.name];
  const scripts = folder.scripts ?? {};
  const headers = folder.headers ?? [];

  const subTabs: { id: FolderSubTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "headers", label: "Headers" },
    { id: "auth", label: "Authorization" },
    { id: "variables", label: "Variables" },
    { id: "scripts", label: "Scripts" },
    { id: "tests", label: "Tests" },
  ];

  return (
    <div className="kp-collection-editor kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <FolderCog size={17} />
        </span>
        <input
          className="kp-collection-name"
          value={folder.name}
          onChange={(e) => set({ name: e.target.value })}
          aria-label="Folder name"
        />
      </div>
      <div className="kp-collection-meta">
        <span>{collection.name} / {path.join(" / ")}</span>
        <span>·</span>
        <span>folder settings</span>
      </div>

      <div className="kp-req-tabs">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={clsx("kp-req-tab", sub === t.id && "active")}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="kp-collection-body">
        {sub === "overview" && (
          <div className="kp-collection-section">
            <div className="kp-kv-title">Folder markdown</div>
            <textarea
              className="kp-textarea"
              rows={10}
              placeholder={"Describe this folder…\n\nMarkdown is supported: # headings, **bold**, `code`, lists, links."}
              value={folder.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
        )}

        {sub === "headers" && (
          <div className="kp-collection-section">
            <p className="kp-hint">
              Applied to every request in this folder (and its subfolders). A header set
              directly on the request wins on duplicate names.
            </p>
            <FolderHeadersTable pairs={headers} onChange={(h) => set({ headers: h })} />
          </div>
        )}

        {sub === "auth" && (
          <div className="kp-collection-section">
            <p className="kp-hint">
              Applied to every request in this folder whose Authorization type is{" "}
              <code>inherit</code> — taking precedence over the collection's auth.
            </p>
            <AuthEditor
              auth={folder.auth ?? { type: "none" }}
              onChange={(a) => set({ auth: a })}
            />
          </div>
        )}

        {sub === "variables" && (
          <div className="kp-collection-section">
            <PlainVarsTable
              title="Folder variables"
              hint="Variables defined here apply to every request inside this folder (and its subfolders). They override collection and environment variables with the same key, and lose to request-level variables."
              variables={folder.variables ?? []}
              onChange={(vars: FolderVariable[]) => set({ variables: vars })}
            />
          </div>
        )}

        {sub === "scripts" && (
          <div className="kp-collection-section">
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
            </div>
            <p className="kp-hint">
              {which === "pre"
                ? "Runs after the collection's pre-request script and before every request in this folder (and its subfolders)."
                : "Runs after the collection's post-response script and before each request's own post-response script."}
            </p>
            <CodeEditor
              value={(scripts as RequestScripts)[which] ?? ""}
              onChange={(v) => set({ scripts: { ...scripts, [which]: v } })}
              language="javascript"
              height="220px"
            />
          </div>
        )}

        {sub === "tests" && (
          <div className="kp-collection-section">
            <p className="kp-hint">
              Assertions applied to every request in this folder (and its subfolders),
              evaluated alongside each request's own assertions.
            </p>
            <AssertionsEditor
              assertions={folder.assertions ?? []}
              onChange={(list: Assertion[]) => set({ assertions: list })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Headers table for the folder settings (Key / Value / Enabled / delete). */
function FolderHeadersTable({
  pairs,
  onChange,
}: {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
}) {
  const [newKey, setNewKey] = useState("");

  const update = (i: number, field: keyof KeyValuePair, value: string | boolean) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...pairs, { key: newKey.trim(), value: "", enabled: true }]);
      setNewKey("");
    }
  };

  return (
    <div className="kp-kv-table">
      <div className="kp-kv-row kp-kv-head">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span className="kp-kv-menu">
          <MoreHorizontal size={13} />
        </span>
      </div>
      {pairs.map((p, i) => (
        <div className="kp-kv-row" key={i}>
          <input
            type="checkbox"
            className="kp-checkbox"
            checked={p.enabled}
            onChange={(e) => update(i, "enabled", e.target.checked)}
          />
          <input type="text" value={p.key} placeholder="Key" onChange={(e) => update(i, "key", e.target.value)} />
          <input type="text" value={p.value} placeholder="Value" onChange={(e) => update(i, "value", e.target.value)} />
          <button
            type="button"
            className="kp-icon-btn kp-danger"
            title="Remove header"
            onClick={() => onChange(pairs.filter((_, idx) => idx !== i))}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
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
      </div>
    </div>
  );
}

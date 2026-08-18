import type { Collection, Folder, Variable } from "@knockport/core";
import { clsx } from "clsx";
import { Boxes, Play } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { AuthEditor } from "../common/AuthEditor";
import { CodeEditor } from "../common/CodeEditor";
import { HeadersTable } from "../common/HeadersTable";
import { VariablesTable } from "../common/VariablesTable";

type SubTab = "overview" | "auth" | "headers" | "scripts" | "variables" | "runs";
// Tests are written in the Post-response script (kp.test / pm.test) — the
// former Tests column is deprecated, like Hoppscotch's script-only tests.
type CollectionScriptPhase = "pre" | "postResponse";

function countRequests(collection: Collection): number {
  const countFolder = (f: Folder): number =>
    f.requests.length + f.folders.reduce((acc, x) => acc + countFolder(x), 0);
  return (
    collection.requests.length + collection.folders.reduce((acc, f) => acc + countFolder(f), 0)
  );
}

function countFolders(collection: Collection): number {
  const countFolder = (f: Folder): number =>
    1 + f.folders.reduce((acc, x) => acc + countFolder(x), 0);
  return collection.folders.reduce((acc, f) => acc + countFolder(f), 0);
}

/**
 * Full-area collection editor tab (Postman/Bruno style): Overview,
 * Authorization, Headers, Scripts, Variables and Runs subtabs. Collection
 * headers (J2) apply to every request in the collection; folder and request
 * entries override them on duplicate names. Edits apply immediately and
 * persist to IndexedDB via updateCollection.
 */
export function CollectionEditor({ collectionId }: { collectionId: string }) {
  const collections = useAppStore((s) => s.collections);
  const updateCollection = useAppStore((s) => s.updateCollection);
  const openRunnerTab = useAppStore((s) => s.openRunnerTab);
  const runs = useAppStore((s) => s.collectionRuns);
  const [sub, setSub] = useState<SubTab>("overview");
  const [which, setWhich] = useState<CollectionScriptPhase>("pre");
  const collection = collections.find((c) => c.id === collectionId);

  if (!collection) return null;

  const set = (changes: Partial<Collection>) => updateCollection(collection.id, changes);
  const variables = collection.variables ?? [];
  const setVars = (vars: Variable[]) => set({ variables: vars });

  const subTabs: { id: SubTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "auth", label: "Authorization" },
    { id: "headers", label: "Headers" },
    { id: "scripts", label: "Scripts" },
    { id: "variables", label: "Variables" },
    { id: "runs", label: "Runs" },
  ];
  const colRuns = runs.filter((r) => r.collectionId === collectionId);
  const scripts = collection.scripts ?? {};
  const scriptValue = which === "pre" ? (scripts.pre ?? "") : (scripts.postResponse ?? "");

  return (
    <div className="kp-collection-editor kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <Boxes size={17} />
        </span>
        <input
          className="kp-collection-name"
          value={collection.name}
          onChange={(e) => set({ name: e.target.value })}
          aria-label="Collection name"
        />
        <button
          type="button"
          className="kp-btn primary"
          onClick={() => openRunnerTab(collection.id)}
        >
          <Play size={13} /> Run
        </button>
      </div>
      <div className="kp-collection-meta">
        <span>{countRequests(collection)} requests</span>
        <span>·</span>
        <span>{countFolders(collection)} folders</span>
        <span>·</span>
        <span>
          updated {new Date(collection.metadata?.updatedAt ?? Date.now()).toLocaleString()}
        </span>
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
            <div className="kp-kv-title">Collection markdown</div>
            <textarea
              className="kp-textarea"
              rows={10}
              placeholder={
                "Describe this collection…\n\nMarkdown is supported: # headings, **bold**, `code`, lists, links."
              }
              value={collection.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
        )}

        {sub === "auth" && (
          <div className="kp-collection-section">
            <p className="kp-hint">
              Applied to every request whose Authorization type is <code>inherit</code> (the default
              for new requests in this collection).
            </p>
            <AuthEditor
              auth={collection.auth ?? { type: "none" }}
              onChange={(a) => set({ auth: a })}
            />
          </div>
        )}

        {sub === "headers" && (
          <div className="kp-collection-section">
            <p className="kp-hint">
              Applied to every request in this collection (and every folder in it). A header
              set on a folder or directly on a request wins on duplicate names.
            </p>
            <HeadersTable
              pairs={collection.headers ?? []}
              onChange={(h) => set({ headers: h })}
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
                ? "Runs before every request in this collection, ahead of the request's own pre-request script."
                : "Runs after every request in this collection, ahead of the request's own post-response script. Write tests here with kp.test / pm.test."}
            </p>
            <CodeEditor
              value={scriptValue}
              onChange={(v) => set({ scripts: { ...scripts, [which]: v } })}
              language="javascript"
              height="220px"
            />
          </div>
        )}

        {sub === "variables" && (
          <div className="kp-collection-section">
            <p className="kp-hint">
              Available in every request of this collection as <code>{"{{variable_name}}"}</code>{" "}
              and as <code>pm.collectionVariables.*</code> in scripts. Environment variables
              override collection variables with the same key. Mark credentials as{" "}
              <code>secret</code> — their values are masked here and redacted from exports
              and history.
            </p>
            <VariablesTable variables={variables} onChange={setVars} />
          </div>
        )}

        {sub === "runs" && (
          <div className="kp-collection-section kp-collection-runs">
            {colRuns.length === 0 ? (
              <p className="kp-hint">
                No runs yet. Use the collection runner (▶ Run) to execute this collection.
              </p>
            ) : (
              colRuns.map((run) => {
                const passed = run.results.filter((r) => r.ok).length;
                return (
                  <div className="kp-card" key={run.id}>
                    <div className="kp-card-title">
                      {new Date(run.startedAt).toLocaleString()} · {run.iterations} iteration
                      {run.iterations === 1 ? "" : "s"} · {passed}/{run.results.length} passed
                    </div>
                    {run.results.map((r, i) => (
                      <div className="kp-runner-row" key={i}>
                        <span className={`kp-runner-status ${r.ok ? "ok" : "fail"}`}>
                          {r.ok ? "PASS" : "FAIL"}
                        </span>
                        <span className="kp-runner-name">
                          {r.method} {r.name}
                          {r.error ? ` — ${r.error}` : ""}
                        </span>
                        {r.testsTotal !== undefined && (
                          <span className="kp-runner-meta">
                            {r.testsPassed}/{r.testsTotal} tests
                          </span>
                        )}
                        <span className="kp-runner-meta">
                          {r.status} · {r.time}ms
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

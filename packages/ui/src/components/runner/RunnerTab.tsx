import type { Collection, Folder, Request } from "@knockport/core";
import {
  collectPromptVariableNames,
  collectRequestPromptVariables,
  ensureOAuth2AndAttach,
  withPromptAnswers,
} from "@knockport/core";
import { clsx } from "clsx";
import { CheckCircle2, Loader2, Play, RotateCcw, X, XCircle } from "lucide-react";
import { useState } from "react";
import {
  type CollectionRunEntry,
  DEFAULT_RUNNER_STATE,
  type RunnerTabState,
  useAppStore,
} from "../../store/app-store";
import { promptForVariables } from "../../store/prompts";
import {
  buildVariableMap,
  collectionVariablesMap,
  environmentVariableMap,
  folderVariablesFor,
  globalsVariableMap,
  resolveRequest,
} from "../../store/variables";
import { statusGroupColor, statusLabel } from "../response/status";

type Filter = "all" | "passed" | "failed";
type DetailTab = "response" | "headers" | "tests";

function flattenRequests(collection: Collection): Request[] {
  const out: Request[] = [];
  const walkFolder = (f: Folder) => {
    for (const r of f.requests) out.push(r);
    for (const sub of f.folders) walkFolder(sub);
  };
  for (const r of collection.requests) out.push(r);
  for (const f of collection.folders) walkFolder(f);
  return out;
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/**
 * Full-area collection runner tab (Postman/Bruno style). Config phase lists
 * the collection's requests with checkboxes; after a run the left pane shows
 * per-request results and selecting one inspects its response on the right.
 * State lives in the app store so the tab survives being switched away.
 */
export function RunnerTab({ collectionId }: { collectionId: string }) {
  const collections = useAppStore((s) => s.collections);
  const collection = collections.find((c) => c.id === collectionId);
  const rs = useAppStore((s) => s.runnerStates[collectionId] ?? DEFAULT_RUNNER_STATE);
  const setRunnerState = useAppStore((s) => s.setRunnerState);
  const environments = useAppStore((s) => s.environments);
  const activeEnvironmentId = useAppStore((s) => s.activeEnvironmentId);

  const [detailTab, setDetailTab] = useState<DetailTab>("response");

  if (!collection) return null;

  const { phase, iterations, delay, results, selectedIdx, filter } = rs;
  const excluded = new Set(rs.excluded);
  const patch = (p: Partial<RunnerTabState>) => setRunnerState(collectionId, p);

  const requests = flattenRequests(collection);
  const included = requests.filter((r) => !excluded.has(r.id));

  const runnerEnv = environments.find((e) => e.id === rs.runnerEnvironmentId);
  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patch({ excluded: [...next] });
  };

  const run = async () => {
    if (included.length === 0) return;
    patch({ phase: "running", results: [], selectedIdx: null, stoppedReason: undefined });
    const { getTransport } = await import("@knockport/transport");
    const {
      runTests,
      runPreScript,
      runPostResponseScript,
      runPostResponseVars,
      mergeTestSummaries,
    } = await import("@knockport/engine");
    const transport = getTransport({
      useRelay: useAppStore.getState().useRelay,
      relayUrl: useAppStore.getState().relayUrl,
      relayToken: useAppStore.getState().relayToken,
    });
    const all: CollectionRunEntry[] = [];
    const startedAt = new Date().toISOString();
    // Post-response variable mutations carry into the next request's runtime
    // scope (Bruno-style). Reset per outer run. The "keep variable values"
    // toggle (D3) disables the carry, giving each request a fresh scope.
    let carryVars: Record<string, string> = {};
    // D3 runner environment: executes against the picked env instead of the
    // active one; optionally merges the active env's variables underneath.
    const envOverride = () => {
      const picker = useAppStore.getState().runnerStates[collectionId] ?? DEFAULT_RUNNER_STATE;
      const picked = useAppStore
        .getState()
        .environments.find((e) => e.id === picker.runnerEnvironmentId);
      return picked ? { runnerEnv: picked, includeActiveEnv: picker.includeActiveEnv } : undefined;
    };

    // Prompt variables (A5): asked once at run start (Bruno semantics — one
    // dialog per run), carried into every request/iteration. Cancel aborts.
    const promptNames = [
      ...new Set([
        ...included.flatMap((r) => collectRequestPromptVariables(r)),
        ...collectPromptVariableNames(
          collection.scripts?.pre ?? "",
          collection.scripts?.test ?? "",
          collection.scripts?.postResponse ?? "",
        ),
      ]),
    ];
    const promptAnswers = await promptForVariables(promptNames);
    if (promptAnswers === null) {
      patch({ phase: "config" });
      return;
    }
    const promptVars = withPromptAnswers({}, promptAnswers);

    let stoppedReason: string | undefined;
    outer: for (let it = 0; it < iterations; it++) {
      for (const collectionCopy of included) {
        const state = useAppStore.getState();
        const override = envOverride();
        // Prefer the live copy from an open request tab so unsaved edits are executed
        const liveTab = state.tabs.find(
          (t) => (!t.kind || t.kind === "request") && t.requestId === collectionCopy.id,
        );
        const req = (liveTab && state.requests[liveTab.id]) || collectionCopy;
        // Folder-inherited variables (A2) for this request's folder chain.
        const folderVars = folderVariablesFor(collection, req.id);
        let vars = {
          ...buildVariableMap(state, override, {
            folderVars,
            requestVars: req.requestVars,
          }),
          ...carryVars,
          ...promptVars,
        };
        const opts = {
          environment: environmentVariableMap(state, override),
          collectionVariables: collectionVariablesMap(state),
          globals: globalsVariableMap(state),
          request: req,
        };
        if (collection.scripts?.pre?.trim()) {
          vars = runPreScript(collection.scripts.pre, vars, opts).variables;
        }
        if (req.scripts?.pre?.trim()) {
          vars = runPreScript(req.scripts.pre, vars, opts).variables;
        }
        const resolved = resolveRequest(req, vars, collection);
        // OAuth2 (B1): attach the stored token; refresh first when expired.
        if (resolved.auth.type === "oauth2" && resolved.auth.oauth2?.accessToken) {
          await ensureOAuth2AndAttach(resolved, resolved.auth, transport);
        }
        const start = performance.now();
        // Enforce the global timeout per request via an abort signal
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), state.timeoutMs);
        let failed = false;
        try {
          const res = await transport.execute(resolved, { signal: abort.signal });
          clearTimeout(timer);

          // Response variables (A1 res side): expressions evaluated against
          // the response; results merge into the carried runtime scope.
          // Only the post-response delta carries into the next request (a
          // request's own vars must not leak into its followers).
          const prePostVars = vars;
          if (req.responseVars?.length) {
            const resVars = runPostResponseVars(res, req.responseVars, vars, opts);
            vars = resVars.vars;
          }

          // Post-response phase (Bruno ordering): runs before the test
          // phase. Its variable mutations carry into the next request.
          const postScript = [collection.scripts?.postResponse, req.scripts?.postResponse]
            .filter((s) => s?.trim())
            .join("\n");
          let postSummary = null;
          let finalVars = vars;
          if (postScript.trim()) {
            const post = await runPostResponseScript(res, postScript, vars, opts);
            finalVars = post.variables;
            postSummary = post.summary;
          }
          // D3 keep-variable-values: when off, every request starts with a
          // fresh runtime scope — mutations do not carry forward.
          carryVars = {};
          if (rs.keepVariableValues) {
            for (const [k, v] of Object.entries(finalVars)) {
              if (prePostVars[k] !== v) carryVars[k] = v;
            }
          }

          let testsPassed: number | undefined;
          let testsTotal: number | undefined;
          let testsOk = true;
          let testSummary = null;
          const testScript = [collection.scripts?.test, req.scripts?.test]
            .filter((s) => s?.trim())
            .join("\n");
          const assertions = [...(collection.assertions ?? []), ...(req.assertions ?? [])];
          if (testScript.trim() || assertions.length) {
            const summary = await runTests(res, {
              script: testScript || undefined,
              assertions,
              environment: environmentVariableMap(state, override),
              collectionVariables: collectionVariablesMap(state),
              globals: globalsVariableMap(state),
              variables: vars,
              request: resolved,
            });
            testSummary = summary;
            testsPassed = summary.passed;
            testsTotal = summary.tests.length;
            testsOk = summary.failed === 0 && !summary.scriptError;
          }
          if (postSummary) {
            testSummary = testSummary ? mergeTestSummaries(postSummary, testSummary) : postSummary;
            testsPassed = testSummary.passed;
            testsTotal = testSummary.tests.length;
            testsOk = testsOk && postSummary.failed === 0 && !postSummary.scriptError;
          }
          failed = !(res.status >= 200 && res.status < 400 && testsOk);
          all.push({
            name: req.name,
            method: req.method,
            status: res.status,
            time: Math.round(performance.now() - start),
            ok: !failed,
            testsPassed,
            testsTotal,
            url: resolved.url,
            // D3 persist-responses: drop the body when off (headers survive).
            response: rs.persistResponses
              ? res
              : { ...res, body: "", bodySize: 0 },
            testSummary,
          });
        } catch (err) {
          clearTimeout(timer);
          failed = true;
          all.push({
            name: req.name,
            method: req.method,
            status: 0,
            time: Math.round(performance.now() - start),
            ok: false,
            error: err instanceof Error ? err.message : "failed",
            url: resolved.url,
            response: null,
            testSummary: null,
          });
        }
        patch({ results: [...all] });
        // D3 stop-on-error / bail: abort the rest of the run after the first
        // failed or errored request.
        if (rs.stopOnError && failed) {
          stoppedReason = `Stopped on error: ${req.name} (iteration ${it + 1}) failed`;
          break outer;
        }
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }
    }
    useAppStore.getState().recordCollectionRun({
      id: crypto.randomUUID(),
      collectionId: collection.id,
      startedAt,
      iterations,
      results: all,
    });
    patch({ phase: "done", stoppedReason });
  };

  const reset = () => {
    patch({ phase: "config", results: [], selectedIdx: null, filter: "all" });
  };

  const counts = {
    all: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  const visible = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (filter === "passed" ? r.ok : filter === "failed" ? !r.ok : true));
  const selected = selectedIdx !== null ? results[selectedIdx] : null;

  return (
    <div className="kp-runner-tab">
      <div className="kp-runner-head">
        <span className="kp-collection-icon">
          <Play size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kp-runner-title">Runner · {collection.name}</div>
          <div className="kp-runner-sub">
            {phase === "config"
              ? `${included.length} of ${requests.length} requests selected`
              : `${counts.passed}/${counts.all} passed · ${iterations} iteration${iterations === 1 ? "" : "s"}`}
          </div>
        </div>
        {phase !== "running" && (
          <>
            <label className="kp-runner-field">
              Iterations
              <input
                type="number"
                min={1}
                max={10}
                value={iterations}
                onChange={(e) => patch({ iterations: Number(e.target.value) || 1 })}
              />
            </label>
            <label className="kp-runner-field">
              Delay (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={delay}
                onChange={(e) => patch({ delay: Number(e.target.value) || 0 })}
              />
            </label>
            <button
              type="button"
              className="kp-btn primary"
              onClick={run}
              disabled={phase !== "config" && included.length === 0}
            >
              <Play size={13} /> {phase === "done" ? "Run Again" : "Run"}
            </button>
            {phase === "done" && (
              <button type="button" className="kp-btn" onClick={reset}>
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </>
        )}
        {phase === "running" && (
          <span className="kp-runner-running">
            <Loader2 size={14} className="animate-spin" /> Running…
          </span>
        )}
      </div>

      {phase === "config" && (
        <div className="kp-runner-options">
          <label className="kp-runner-field">
            Environment
            <select
              className="kp-runner-env-select"
              value={rs.runnerEnvironmentId ?? ""}
              onChange={(e) => patch({ runnerEnvironmentId: e.target.value || null })}
            >
              <option value="">
                Active environment{activeEnv ? ` (${activeEnv.name})` : ""}
              </option>
              {environments
                .filter((e) => e.id !== activeEnvironmentId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          {runnerEnv && (
            <label className="kp-runner-check" title="Also merge the active environment's variables underneath the picked one">
              <input
                type="checkbox"
                className="kp-checkbox"
                checked={rs.includeActiveEnv}
                onChange={(e) => patch({ includeActiveEnv: e.target.checked })}
              />
              Include active env
            </label>
          )}
          <label className="kp-runner-check" title="Stop the run after the first failed or errored request">
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={rs.stopOnError}
              onChange={(e) => patch({ stopOnError: e.target.checked })}
            />
            Stop on error
          </label>
          <label className="kp-runner-check" title="Carry script-set variables into subsequent requests of the run">
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={rs.keepVariableValues}
              onChange={(e) => patch({ keepVariableValues: e.target.checked })}
            />
            Keep variable values
          </label>
          <label className="kp-runner-check" title="Retain response bodies in the results for inspection">
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={rs.persistResponses}
              onChange={(e) => patch({ persistResponses: e.target.checked })}
            />
            Persist responses
          </label>
        </div>
      )}

      {phase === "done" && rs.stoppedReason && (
        <div className="kp-runner-error">{rs.stoppedReason}</div>
      )}

      {phase !== "config" && (
        <div className="kp-seg-row">
          {(["all", "passed", "failed"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={clsx("kp-seg", filter === f && "active")}
              onClick={() => patch({ filter: f })}
            >
              {f === "all" ? "All" : f === "passed" ? "Passed" : "Failed"} · {counts[f]}
            </button>
          ))}
        </div>
      )}

      <div className="kp-runner-main">
        <div className="kp-runner-list kp-scroll">
          {phase === "config"
            ? requests.map((r) => (
                <label className="kp-runner-list-row" key={r.id}>
                  <input
                    type="checkbox"
                    className="kp-checkbox"
                    checked={!excluded.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <span className="kp-method-tag">{r.method}</span>
                  <span className="kp-truncate" style={{ flex: 1 }}>
                    {r.name}
                  </span>
                </label>
              ))
            : visible.map(({ r, i }) => (
                <button
                  type="button"
                  key={i}
                  className={clsx("kp-runner-list-row", selectedIdx === i && "active")}
                  onClick={() => {
                    patch({ selectedIdx: i });
                    setDetailTab("response");
                  }}
                >
                  {r.ok ? (
                    <CheckCircle2 size={15} className="kp-runner-icon ok" />
                  ) : (
                    <XCircle size={15} className="kp-runner-icon fail" />
                  )}
                  <span className="kp-method-tag">{r.method}</span>
                  <span className="kp-truncate" style={{ flex: 1 }}>
                    {r.name}
                  </span>
                  <span className="kp-runner-meta">
                    <span style={{ color: statusGroupColor(r.status), fontWeight: 700 }}>
                      {r.status || "—"}
                    </span>{" "}
                    · {r.time} ms
                  </span>
                </button>
              ))}
          {phase === "config" && requests.length === 0 && (
            <p className="kp-hint">This collection has no requests yet.</p>
          )}
        </div>

        <div className="kp-runner-detail kp-scroll">
          {phase === "config" && (
            <div className="kp-runner-empty">
              <Play size={40} strokeWidth={1.2} />
              <p>Select requests, then press Run to execute the collection.</p>
            </div>
          )}
          {phase !== "config" && !selected && (
            <div className="kp-runner-empty">
              <Play size={40} strokeWidth={1.2} />
              <p>
                {results.length === 0
                  ? "Waiting for results…"
                  : "Select a request to inspect its response."}
              </p>
            </div>
          )}
          {selected && (
            <>
              <div className="kp-runner-detail-head">
                <span className="kp-method-tag">{selected.method}</span>
                <span className="kp-runner-detail-name">{selected.name}</span>
                <button
                  type="button"
                  className="kp-icon-btn"
                  title="Close"
                  onClick={() => patch({ selectedIdx: null })}
                >
                  <X size={13} />
                </button>
              </div>
              {selected.url && <div className="kp-runner-url">{selected.url}</div>}
              {selected.error && <div className="kp-runner-error">{selected.error}</div>}
              <div className="kp-runner-detail-meta">
                <span
                  className="kp-runner-detail-status"
                  style={{ color: statusGroupColor(selected.status) ?? "var(--kp-status-5xx)" }}
                >
                  {selected.status
                    ? statusLabel(selected.status, selected.response?.statusText)
                    : "failed"}
                </span>
                <span>{selected.time} ms</span>
                {selected.response && <span>{selected.response.bodySize} B</span>}
                {selected.testsTotal !== undefined && (
                  <span>
                    tests {selected.testsPassed}/{selected.testsTotal}
                  </span>
                )}
              </div>

              <div className="kp-seg-row">
                {(["response", "headers", "tests"] as DetailTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={clsx("kp-seg", detailTab === t && "active")}
                    onClick={() => setDetailTab(t)}
                  >
                    {t === "response" ? "Response" : t === "headers" ? "Headers" : "Tests"}
                  </button>
                ))}
              </div>

              {detailTab === "response" && (
                <pre className="kp-code-block kp-runner-body">
                  {!selected.response
                    ? "No response received."
                    : !rs.persistResponses && selected.response.body === ""
                      ? "Response body not persisted — enable Persist responses to inspect bodies."
                      : formatBody(selected.response.body)}
                </pre>
              )}

              {detailTab === "headers" && (
                <div className="kp-kv-list">
                  {selected.response &&
                    Object.entries(selected.response.headers).map(([k, v]) => (
                      <div className="kp-kv-list-row" key={k}>
                        <span className="kp-kv-key">{k}</span>
                        <span className="kp-kv-val">{v}</span>
                      </div>
                    ))}
                  {(!selected.response || Object.keys(selected.response.headers).length === 0) && (
                    <p className="kp-hint">No headers.</p>
                  )}
                </div>
              )}

              {detailTab === "tests" && (
                <div className="kp-runner-tests">
                  {selected.testSummary?.scriptError && (
                    <div className="kp-runner-error">{selected.testSummary.scriptError}</div>
                  )}
                  {selected.testSummary?.tests.map((t, i) => (
                    <div className={clsx("kp-test-row", t.passed ? "pass" : "fail")} key={i}>
                      {t.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      <span style={{ flex: 1 }}>{t.name}</span>
                      {t.message && <span className="kp-test-msg">{t.message}</span>}
                    </div>
                  ))}
                  {!selected.testSummary && (
                    <p className="kp-hint">No tests ran for this request.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

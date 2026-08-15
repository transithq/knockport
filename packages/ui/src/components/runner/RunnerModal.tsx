import { useState } from "react";
import { Play, X, Loader2 } from "lucide-react";
import { useAppStore } from "../../store/app-store";
import { buildVariableMap, resolveRequest } from "../../store/variables";
import type { Collection, Folder, Request } from "@knockport/core";

interface RunResult {
  name: string;
  method: string;
  status: number;
  time: number;
  ok: boolean;
  error?: string;
}

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

export function RunnerModal() {
  const open = useAppStore((s) => s.runnerOpen);
  const setOpen = useAppStore((s) => s.setRunnerOpen);
  const collections = useAppStore((s) => s.collections);
  const [collectionId, setCollectionId] = useState("");
  const [iterations, setIterations] = useState(1);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);

  if (!open) return null;

  const selected = collections.find((c) => c.id === collectionId) ?? collections[0];

  const run = async () => {
    if (!selected) return;
    setRunning(true);
    setResults([]);
    const { DirectTransport } = await import("@knockport/transport");
    const transport = new DirectTransport();
    const requests = flattenRequests(selected);
    const all: RunResult[] = [];

    for (let it = 0; it < iterations; it++) {
      for (const req of requests) {
        const state = useAppStore.getState();
        const resolved = resolveRequest(req, buildVariableMap(state));
        const start = performance.now();
        try {
          const res = await transport.execute(resolved);
          all.push({
            name: req.name,
            method: req.method,
            status: res.status,
            time: Math.round(performance.now() - start),
            ok: res.status >= 200 && res.status < 400,
          });
        } catch (err) {
          all.push({
            name: req.name,
            method: req.method,
            status: 0,
            time: Math.round(performance.now() - start),
            ok: false,
            error: err instanceof Error ? err.message : "failed",
          });
        }
        setResults([...all]);
      }
    }
    setRunning(false);
  };

  const passed = results.filter((r) => r.ok).length;

  return (
    <div className="kp-cmdk-overlay" onClick={() => !running && setOpen(false)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Collection Runner</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(false)} disabled={running}><X size={14} /></button>
        </div>

        <div className="kp-runner-controls">
          <label>
            Collection
            <select value={selected?.id ?? ""} onChange={(e) => setCollectionId(e.target.value)} disabled={running}>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Iterations
            <input type="number" min={1} max={10} value={iterations} onChange={(e) => setIterations(Number(e.target.value) || 1)} disabled={running} />
          </label>
          <button type="button" className="kp-btn primary" onClick={run} disabled={running || !selected}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
          </button>
        </div>

        <div className="kp-runner-results kp-scroll">
          {results.length === 0 && !running && <p className="kp-hint">Select a collection and press Run.</p>}
          {results.map((r, i) => (
            <div className="kp-runner-row" key={i}>
              <span className={`kp-runner-status ${r.ok ? "ok" : "fail"}`}>{r.ok ? "PASS" : "FAIL"}</span>
              <span className="kp-method-tag">{r.method}</span>
              <span className="kp-runner-name">{r.name}</span>
              <span className="kp-runner-meta">{r.status} • {r.time} ms</span>
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <div className="kp-modal-footer">
            <span className="kp-hint">{passed}/{results.length} passed</span>
          </div>
        )}
      </div>
    </div>
  );
}

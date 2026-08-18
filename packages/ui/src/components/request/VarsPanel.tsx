import type { RequestVariable, ResponseVariable } from "@knockport/core";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store/app-store";

/**
 * Request-scoped variables (A1 — Bruno `vars:pre-request` /
 * `vars:post-response`; Hoppscotch RequestVariables). Two tables:
 *
 * - **Pre-request**: plain key/value pairs seeded into the interpolation map
 *   above the environment layer before the request runs.
 * - **Post-response**: JS expressions evaluated against the response after
 *   each send; the results land in the runtime scope for post-response/test
 *   scripts and the collection runner's next request.
 */
export function VarsPanel({ tabId }: { tabId: string }) {
  const requests = useAppStore((s) => s.requests);
  const updateRequest = useAppStore((s) => s.updateRequest);
  const request = requests[tabId];
  if (!request) return null;

  const reqVars = request.requestVars ?? [];
  const resVars = request.responseVars ?? [];
  const setReqVars = (vars: RequestVariable[]) => updateRequest(tabId, { requestVars: vars });
  const setResVars = (vars: ResponseVariable[]) => updateRequest(tabId, { responseVars: vars });

  return (
    <div className="kp-body-editor">
      <VarsTable
        title="Pre-request"
        hint="Seeded before the request runs — available as {{variable_name}} in this request, above all environment layers."
        pairs={reqVars}
        valuePlaceholder="value"
        onChange={setReqVars}
      />
      <VarsTable
        title="Post-response"
        hint="JS expressions evaluated against the response after each send. res.getStatus(), res.getHeader(name), response.json() are all in scope. Results become runtime variables for tests and subsequent requests."
        pairs={resVars}
        valuePlaceholder="expr — e.g. response.json().token"
        onChange={setResVars}
      />
      <ExtractedVars tabId={tabId} />
    </div>
  );
}

function VarsTable({
  title,
  hint,
  pairs,
  valuePlaceholder,
  onChange,
}: {
  title: string;
  hint: string;
  pairs: (RequestVariable | ResponseVariable)[];
  valuePlaceholder: string;
  onChange: (pairs: (RequestVariable | ResponseVariable)[]) => void;
}) {
  const [newKey, setNewKey] = useState("");

  const update = (i: number, field: keyof RequestVariable, value: string | boolean) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));

  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...pairs, { key: newKey.trim(), value: "", enabled: true }]);
      setNewKey("");
    }
  };

  return (
    <div className="kp-kv">
      <div className="kp-kv-title">{title}</div>
      <p className="kp-hint">{hint}</p>
      <div className="kp-kv-table kp-vars-table">
        <div className="kp-kv-row kp-kv-head">
          <span />
          <span>Name</span>
          <span>Value</span>
          <span />
        </div>

        {pairs.map((p, i) => (
          <div className="kp-kv-row" key={i}>
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={p.enabled !== false}
              onChange={(e) => update(i, "enabled", e.target.checked)}
            />
            <input
              type="text"
              value={p.key}
              placeholder="variable_name"
              onChange={(e) => update(i, "key", e.target.value)}
            />
            <input
              type="text"
              value={p.value}
              placeholder={valuePlaceholder}
              onChange={(e) => update(i, "value", e.target.value)}
            />
            <button
              type="button"
              className="kp-icon-btn kp-danger"
              title="Remove variable"
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
            placeholder="Name"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitNew()}
            onBlur={commitNew}
          />
          <input type="text" placeholder={valuePlaceholder} readOnly />
          <span />
        </div>
      </div>
    </div>
  );
}

/** Read-only view of the variables extracted from the last response. */
function ExtractedVars({ tabId }: { tabId: string }) {
  const extracted = useAppStore((s) => s.extractedVars[tabId]);
  if (!extracted) return null;
  const entries = Object.entries(extracted);
  if (entries.length === 0) return null;

  return (
    <div className="kp-kv">
      <div className="kp-kv-title">Extracted from last response</div>
      <div className="kp-kv-list">
        {entries.map(([k, v]) => (
          <div className="kp-kv-list-row" key={k}>
            <span className="kp-kv-key">{k}</span>
            <span className="kp-kv-val">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

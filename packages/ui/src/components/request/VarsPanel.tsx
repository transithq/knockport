import type { RequestVariable, ResponseVariable } from "@knockport/core";
import { useAppStore } from "../../store/app-store";
import { PlainVarsTable } from "../common/PlainVarsTable";

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

  const setReqVars = (vars: RequestVariable[]) => updateRequest(tabId, { requestVars: vars });
  const setResVars = (vars: ResponseVariable[]) => updateRequest(tabId, { responseVars: vars });

  return (
    <div className="kp-body-editor">
      <PlainVarsTable
        title="Pre-request"
        hint="Seeded before the request runs — available as {{variable_name}} in this request, above all environment layers."
        variables={request.requestVars ?? []}
        onChange={setReqVars}
      />
      <PlainVarsTable
        title="Post-response"
        hint="JS expressions evaluated against the response after each send (response.json() / res.getHeader(name) / res.getStatus() are in scope). Results become runtime variables for tests and subsequent requests."
        variables={request.responseVars ?? []}
        valuePlaceholder="expr — e.g. response.json().token"
        onChange={setResVars}
      />
      <ExtractedVars tabId={tabId} />
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

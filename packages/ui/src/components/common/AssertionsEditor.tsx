import { Plus, Trash2 } from "lucide-react";
import type { Assertion } from "@knockport/core";
import { type Suggestion, SuggestInput } from "./SuggestInput";

// ── Assertions Editor ────────────────────────────────────────────────────────
// Declarative response assertions (expression must evaluate to true).
// Shared by the request Tests panel and the collection Tests subtab.
// The expression field offers Tab-completion snippets against the `response`
// object the engine exposes (status/statusText/headers/body/responseTime/size).

const ASSERTION_SNIPPETS: Suggestion[] = [
  { label: "response.status === 200", insert: "response.status === 200", hint: "status code" },
  { label: 'response.statusText === "OK"', insert: 'response.statusText === "OK"', hint: "status text" },
  { label: "response.responseTime < 500", insert: "response.responseTime < 500", hint: "latency (ms)" },
  { label: "response.size < 10240", insert: "response.size < 10240", hint: "size (bytes)" },
  {
    label: 'response.headers["content-type"] !== undefined',
    insert: 'response.headers["content-type"] !== undefined',
    hint: "header",
  },
  { label: 'response.body.includes("")', insert: 'response.body.includes("")', hint: "body contains" },
  {
    label: "JSON.parse(response.body).id !== undefined",
    insert: "JSON.parse(response.body).id !== undefined",
    hint: "json field",
  },
];

function assertionSuggestions(value: string): Suggestion[] {
  const t = value.trim();
  if (!t) return ASSERTION_SNIPPETS;
  return ASSERTION_SNIPPETS.filter((s) => s.insert.startsWith(t));
}

export function AssertionsEditor({ assertions, onChange }: { assertions: Assertion[]; onChange: (a: Assertion[]) => void }) {
  return (
    <div className="kp-tests-editor">
      {assertions.map((a, i) => (
        <div className="kp-test-edit-row" key={i}>
          <SuggestInput
            className="kp-mono"
            value={a.expression}
            placeholder="response.status === 200  (Tab for suggestions)"
            suggestions={assertionSuggestions}
            onChange={(v) => {
              const next = [...assertions];
              next[i] = { ...next[i], expression: v };
              onChange(next);
            }}
          />
          <input
            value={a.description ?? ""}
            placeholder="description (optional)"
            onChange={(e) => {
              const next = [...assertions];
              next[i] = { ...next[i], description: e.target.value || undefined };
              onChange(next);
            }}
          />
          <button type="button" className="kp-icon-btn" title="Remove" onClick={() => onChange(assertions.filter((_, j) => j !== i))}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="kp-lang-btn" onClick={() => onChange([...assertions, { expression: "" }])}>
        <Plus size={12} /> Add assertion
      </button>
    </div>
  );
}

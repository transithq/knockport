import { Plus, Trash2 } from "lucide-react";
import type { Assertion } from "@knockport/core";

// ── Assertions Editor ────────────────────────────────────────────────────────
// Declarative response assertions (expression must evaluate to true).
// Shared by the request Tests panel and the collection Tests subtab.
export function AssertionsEditor({ assertions, onChange }: { assertions: Assertion[]; onChange: (a: Assertion[]) => void }) {
  return (
    <div className="kp-tests-editor">
      {assertions.map((a, i) => (
        <div className="kp-test-edit-row" key={i}>
          <input
            className="kp-mono"
            value={a.expression}
            placeholder="response.status === 200"
            onChange={(e) => {
              const next = [...assertions];
              next[i] = { ...next[i], expression: e.target.value };
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

import { Plus, Trash2 } from "lucide-react";
import type { Assertion } from "@knockport/core";
import { type Suggestion, SuggestInput } from "./SuggestInput";

// ── Assertions Editor ────────────────────────────────────────────────────────
// Declarative response assertions (expression must evaluate to true).
// Shared by the request Tests panel and the collection Tests subtab.
//
// The expression field offers Tab-completion against the `response` object the
// engine exposes, including operator-based templates drawn from Bruno's
// 28-operator assertion matrix (B§5 assert-runtime). KP stays free-form JS
// (unlike Bruno's path+operator form) — the operator set is the suggestion
// vocabulary, not a constraint.

const L = "JSON.parse(response.body)";

/** Bruno's 28 assertion operators, expressed as KP `response.*` expressions. */
export const OPERATOR_SNIPPETS: Suggestion[] = [
  // Comparison
  { label: "response.status === 200", insert: "response.status === 200", hint: "eq" },
  { label: "response.status !== 500", insert: "response.status !== 500", hint: "neq" },
  { label: "response.responseTime < 500", insert: "response.responseTime < 500", hint: "lt" },
  { label: "response.responseTime <= 500", insert: "response.responseTime <= 500", hint: "lte" },
  { label: "response.size > 0", insert: "response.size > 0", hint: "gt" },
  { label: "response.size >= 64", insert: "response.size >= 64", hint: "gte" },
  // Membership
  { label: "[200, 201].includes(response.status)", insert: "[200, 201].includes(response.status)", hint: "in" },
  { label: "![403, 503].includes(response.status)", insert: "![403, 503].includes(response.status)", hint: "notIn" },
  { label: 'response.body.includes("")', insert: 'response.body.includes("")', hint: "contains" },
  { label: '!response.body.includes("")', insert: '!response.body.includes("")', hint: "notContains" },
  { label: 'response.body.startsWith("{")', insert: 'response.body.startsWith("{")', hint: "startsWith" },
  { label: 'response.body.endsWith("}")', insert: 'response.body.endsWith("}")', hint: "endsWith" },
  // Matching
  { label: "/^HTTP\\/2/.test(response.statusText)", insert: "/^HTTP\\/2/.test(response.statusText)", hint: "matches" },
  { label: "!/error/i.test(response.body)", insert: "!/error/i.test(response.body)", hint: "notMatches" },
  // Length / range
  { label: `${L}.length === 10`, insert: `${L}.length === 10`, hint: "length" },
  { label: "response.size < 10240", insert: "response.size < 10240", hint: "length (bytes)" },
  { label: "response.responseTime >= 50 && response.responseTime <= 500", insert: "response.responseTime >= 50 && response.responseTime <= 500", hint: "between" },
  // Emptiness / emptiness-of-value
  { label: 'response.body === ""', insert: 'response.body === ""', hint: "isEmpty" },
  { label: "response.body !== \"\"", insert: 'response.body !== ""', hint: "isNotEmpty" },
  { label: `${L}.field === null`, insert: `${L}.field === null`, hint: "isNull" },
  { label: `${L}.field === undefined`, insert: `${L}.field === undefined`, hint: "isUndefined" },
  { label: `${L}.field !== undefined`, insert: `${L}.field !== undefined`, hint: "isDefined" },
  { label: `Boolean(${L}.field)`, insert: `Boolean(${L}.field)`, hint: "isTruthy" },
  { label: `!${L}.field`, insert: `!${L}.field`, hint: "isFalsy" },
  // Type guards
  { label: "(() => { try { JSON.parse(response.body); return true; } catch { return false; } })()", insert: "(() => { try { JSON.parse(response.body); return true; } catch { return false; } })()", hint: "isJson" },
  { label: `typeof ${L}.field === "number"`, insert: `typeof ${L}.field === "number"`, hint: "isNumber" },
  { label: `typeof ${L}.field === "string"`, insert: `typeof ${L}.field === "string"`, hint: "isString" },
  { label: `typeof ${L}.field === "boolean"`, insert: `typeof ${L}.field === "boolean"`, hint: "isBoolean" },
  { label: `Array.isArray(${L})`, insert: `Array.isArray(${L})`, hint: "isArray" },
  // Headers
  {
    label: 'response.headers["content-type"] !== undefined',
    insert: 'response.headers["content-type"] !== undefined',
    hint: "header present",
  },
];

/** Empty field shows the operator matrix; typing filters it as a prefix. */
export function assertionSuggestions(value: string): Suggestion[] {
  const t = value.trim();
  if (!t) return OPERATOR_SNIPPETS;
  const exact = OPERATOR_SNIPPETS.filter((s) => s.insert.startsWith(t));
  if (exact.length) return exact;
  // Fall back to hint matches so operator names ("between", "isJson"…) are
  // reachable by typing the Bruno operator word too.
  return OPERATOR_SNIPPETS.filter(
    (s) => s.hint?.toLowerCase().startsWith(t.toLowerCase()) || s.insert.includes(t),
  );
}

export function AssertionsEditor({ assertions, onChange }: { assertions: Assertion[]; onChange: (a: Assertion[]) => void }) {
  return (
    <div className="kp-tests-editor">
      {assertions.map((a, i) => (
        <div className="kp-test-edit-row" key={i}>
          <SuggestInput
            className="kp-mono"
            value={a.expression}
            placeholder="response.status === 200  (Tab — 30 operator templates)"
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

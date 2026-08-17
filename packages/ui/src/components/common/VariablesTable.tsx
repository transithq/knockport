import { useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { Variable } from "@knockport/core";
import clsx from "clsx";

const VARIABLE_TYPES: NonNullable<Variable["type"]>[] = [
  "string",
  "number",
  "boolean",
  "secret",
];

/**
 * Shared key/value editor for environment + collection variables. Secret
 * variables mask their value behind an eye toggle (Bruno/Hoppscotch parity);
 * export and history redaction happens at the format/store layer.
 */
export function VariablesTable({
  variables,
  onChange,
}: {
  variables: Variable[];
  onChange: (variables: Variable[]) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const update = (i: number, field: keyof Variable, value: string | boolean) =>
    onChange(variables.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));
  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...variables, { key: newKey.trim(), value: "", enabled: true }]);
      setNewKey("");
    }
  };
  const toggleReveal = (i: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="kp-kv-table kp-vars-table">
      <div className="kp-kv-row kp-kv-head">
        <span />
        <span>Variable</span>
        <span>Type</span>
        <span>Value</span>
        <span />
        <span />
      </div>

      {variables.map((v, i) => {
        const secret = v.type === "secret";
        const isRevealed = revealed.has(i);
        return (
          <div className="kp-kv-row" key={i}>
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={v.enabled !== false}
              onChange={(e) => update(i, "enabled", e.target.checked)}
            />
            <input
              type="text"
              value={v.key}
              placeholder="variable_name"
              onChange={(e) => update(i, "key", e.target.value)}
            />
            <select
              className="kp-vars-type"
              value={v.type ?? "string"}
              onChange={(e) => update(i, "type", e.target.value)}
              aria-label="Variable type"
            >
              {VARIABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type={secret && !isRevealed ? "password" : "text"}
              className={clsx(secret && "kp-vars-secret")}
              value={v.value}
              placeholder={secret && !isRevealed ? "Secret value" : "value"}
              onChange={(e) => update(i, "value", e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className={clsx("kp-icon-btn", secret ? "kp-secret-toggle" : "kp-secret-toggle-hidden")}
              title={secret ? (isRevealed ? "Hide value" : "Reveal value") : undefined}
              disabled={!secret}
              onClick={() => toggleReveal(i)}
            >
              {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button
              type="button"
              className="kp-icon-btn kp-danger"
              title="Remove variable"
              onClick={() => onChange(variables.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}

      {/* Empty add row — typing a key creates a new variable */}
      <div className="kp-kv-row">
        <span />
        <input
          type="text"
          value={newKey}
          placeholder="Add variable…"
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitNew()}
          onBlur={commitNew}
        />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

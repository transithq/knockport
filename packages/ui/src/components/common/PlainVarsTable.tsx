import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { RequestVariable } from "@knockport/core";

/**
 * Simple enabled key/value editor without the variable-type dropdown
 * (request vars, folder vars — plain pairs, Bruno semantics). Secret handling
 * belongs to {@link VariablesTable} for environment/collection vars.
 */
export function PlainVarsTable<V extends { key: string; value: string; enabled?: boolean }>({
  title,
  hint,
  variables,
  valuePlaceholder = "value",
  onChange,
}: {
  title?: string;
  hint?: string;
  variables: V[];
  valuePlaceholder?: string;
  onChange: (variables: V[]) => void;
}) {
  const [newKey, setNewKey] = useState("");

  const update = (i: number, field: keyof RequestVariable, value: string | boolean) =>
    onChange(variables.map((v, idx) => (idx === i ? ({ ...v, [field]: value } as V) : v)));

  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...variables, { key: newKey.trim(), value: "", enabled: true } as V]);
      setNewKey("");
    }
  };

  return (
    <div className="kp-kv">
      {title && <div className="kp-kv-title">{title}</div>}
      {hint && <p className="kp-hint">{hint}</p>}
      <div className="kp-kv-table kp-vars-table">
        <div className="kp-kv-row kp-kv-head">
          <span />
          <span>Name</span>
          <span>Value</span>
          <span />
        </div>

        {variables.map((v, i) => (
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
            <input
              type="text"
              value={v.value}
              placeholder={valuePlaceholder}
              onChange={(e) => update(i, "value", e.target.value)}
            />
            <button
              type="button"
              className="kp-icon-btn kp-danger"
              title="Remove variable"
              onClick={() => onChange(variables.filter((_, idx) => idx !== i))}
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

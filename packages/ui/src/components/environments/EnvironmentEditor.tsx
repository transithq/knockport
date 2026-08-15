import { useState } from "react";
import { Boxes, Trash2 } from "lucide-react";
import type { Variable } from "@knockport/core";
import { useAppStore } from "../../store/app-store";

/**
 * Full-area environment editor. Opens as a tab in the main workspace
 * (not a floating dialog) — edits apply immediately and persist to IndexedDB.
 */
export function EnvironmentEditor({ envId }: { envId: string }) {
  const environments = useAppStore((s) => s.environments);
  const updateEnvironment = useAppStore((s) => s.updateEnvironment);
  const env = environments.find((e) => e.id === envId);
  const [newKey, setNewKey] = useState("");

  if (!env) return null;

  const setVars = (variables: Variable[]) => updateEnvironment(env.id, { variables });
  const update = (i: number, field: keyof Variable, value: string | boolean) =>
    setVars(env.variables.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));
  const commitNew = () => {
    if (newKey.trim()) {
      setVars([...env.variables, { key: newKey.trim(), value: "", enabled: true }]);
      setNewKey("");
    }
  };

  return (
    <div className="kp-env-editor kp-scroll">
      <div className="kp-env-editor-head">
        <span className="kp-env-editor-icon">
          <Boxes size={15} />
        </span>
        <input
          type="text"
          className="kp-env-name-input"
          value={env.name}
          placeholder="Environment name"
          onChange={(e) => updateEnvironment(env.id, { name: e.target.value })}
        />
      </div>

      <p className="kp-hint">
        Variables are referenced as <code>{"{{variable_name}}"}</code> in request URLs, params,
        headers, bodies and auth. Environment values override collection variables.
      </p>

      <div className="kp-kv-table">
        <div className="kp-kv-row kp-kv-head">
          <span />
          <span>Variable</span>
          <span>Value</span>
          <span />
        </div>

        {env.variables.map((v, i) => (
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
              placeholder="value"
              onChange={(e) => update(i, "value", e.target.value)}
            />
            <button
              type="button"
              className="kp-icon-btn kp-danger"
              title="Remove variable"
              onClick={() => setVars(env.variables.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

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
        </div>
      </div>
    </div>
  );
}

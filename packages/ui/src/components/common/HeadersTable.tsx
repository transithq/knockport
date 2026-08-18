import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import type { KeyValuePair } from "@knockport/core";

/**
 * Key/value/enabled header editor with per-row delete (Key | Value | Enabled |
 * delete). Shared by the folder settings (J1) and the collection-level
 * headers editor (J2).
 */
export function HeadersTable({
  pairs,
  onChange,
}: {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
}) {
  const [newKey, setNewKey] = useState("");

  const update = (i: number, field: keyof KeyValuePair, value: string | boolean) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  const commitNew = () => {
    if (newKey.trim()) {
      onChange([...pairs, { key: newKey.trim(), value: "", enabled: true }]);
      setNewKey("");
    }
  };

  return (
    <div className="kp-kv-table">
      <div className="kp-kv-row kp-kv-head">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span className="kp-kv-menu">
          <MoreHorizontal size={13} />
        </span>
      </div>
      {pairs.map((p, i) => (
        <div className="kp-kv-row" key={i}>
          <input
            type="checkbox"
            className="kp-checkbox"
            checked={p.enabled}
            onChange={(e) => update(i, "enabled", e.target.checked)}
          />
          <input type="text" value={p.key} placeholder="Key" onChange={(e) => update(i, "key", e.target.value)} />
          <input type="text" value={p.value} placeholder="Value" onChange={(e) => update(i, "value", e.target.value)} />
          <button
            type="button"
            className="kp-icon-btn kp-danger"
            title="Remove header"
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
          placeholder="Key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitNew()}
          onBlur={commitNew}
        />
        <input type="text" placeholder="Value" readOnly />
        <span />
      </div>
    </div>
  );
}

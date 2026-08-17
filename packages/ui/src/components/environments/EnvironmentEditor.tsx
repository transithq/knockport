import { Boxes } from "lucide-react";
import type { Variable } from "@knockport/core";
import { useAppStore } from "../../store/app-store";
import { VariablesTable } from "../common/VariablesTable";

/**
 * Full-area environment editor. Opens as a tab in the main workspace
 * (not a floating dialog) — edits apply immediately and persist to IndexedDB.
 * Secret-typed variables mask their value and are redacted on export.
 */
export function EnvironmentEditor({ envId }: { envId: string }) {
  const environments = useAppStore((s) => s.environments);
  const updateEnvironment = useAppStore((s) => s.updateEnvironment);
  const env = environments.find((e) => e.id === envId);

  if (!env) return null;

  const setVars = (variables: Variable[]) => updateEnvironment(env.id, { variables });

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
        headers, bodies and auth. Environment values override collection variables. Mark
        credentials as <code>secret</code> — their values are masked here and redacted from
        exports and history.
      </p>

      <VariablesTable variables={env.variables ?? []} onChange={setVars} />
    </div>
  );
}

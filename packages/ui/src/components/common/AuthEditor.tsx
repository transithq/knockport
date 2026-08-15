import type { AuthConfig } from "@knockport/core";

// ── Auth Editor ──────────────────────────────────────────────────────────────
// Shared by the request Authorization panel and the collection Authorization
// subtab. "inherit" resolves against the parent collection at send time.
export function AuthEditor({ auth, onChange }: { auth: AuthConfig; onChange: (a: AuthConfig) => void }) {
  const types: AuthConfig["type"][] = ["none", "inherit", "bearer", "basic", "apiKey", "oauth2"];
  const label = (t: string) => (t === "apiKey" ? "API Key" : t.charAt(0).toUpperCase() + t.slice(1));

  return (
    <div className="kp-body-editor">
      <div className="kp-seg-row">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className={`kp-seg${auth.type === t ? " active" : ""}`}
            onClick={() => onChange({ type: t })}
          >
            {label(t)}
          </button>
        ))}
      </div>

      {auth.type === "bearer" && (
        <div className="kp-field">
          <label>Token</label>
          <input
            type="text"
            className="kp-mono"
            value={auth.bearer?.token ?? ""}
            placeholder="Enter bearer token"
            onChange={(e) => onChange({ ...auth, bearer: { token: e.target.value } })}
          />
        </div>
      )}
      {auth.type === "basic" && (
        <div className="kp-field-grid">
          <div className="kp-field">
            <label>Username</label>
            <input
              type="text"
              value={auth.basic?.username ?? ""}
              onChange={(e) => onChange({ ...auth, basic: { username: e.target.value, password: auth.basic?.password ?? "" } })}
            />
          </div>
          <div className="kp-field">
            <label>Password</label>
            <input
              type="password"
              value={auth.basic?.password ?? ""}
              onChange={(e) => onChange({ ...auth, basic: { username: auth.basic?.username ?? "", password: e.target.value } })}
            />
          </div>
        </div>
      )}
      {auth.type === "none" && <p className="kp-hint">No authentication</p>}
      {auth.type === "inherit" && <p className="kp-hint">Inherit from parent collection</p>}
    </div>
  );
}

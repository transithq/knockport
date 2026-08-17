import { useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import type { AuthConfig, OAuth2GrantType, OAuth2Transport } from "@knockport/core";
import {
  exchangeCode,
  fetchAccessToken,
  isTokenExpired,
  refreshAccessToken,
  startAuthorize,
} from "@knockport/core";
import { useAppStore } from "../../store/app-store";

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
      {auth.type === "oauth2" && <OAuth2Editor auth={auth} onChange={onChange} />}
      {auth.type === "none" && <p className="kp-hint">No authentication</p>}
      {auth.type === "inherit" && <p className="kp-hint">Inherit from parent collection</p>}
    </div>
  );
}

// ── OAuth2 Editor (B1) ───────────────────────────────────────────────────────
// Flow orchestration lives in @knockport/core (oauth2.ts) on top of the
// tropel core-wasm auth tier: PKCE pair + authorize/token request building,
// token parsing/storing, refresh, expiry and placement all come from Tropel.
// This editor drives the exchange via the active transport and persists the
// stored token back onto the AuthConfig through `onChange`.

const GRANTS: { value: OAuth2GrantType; label: string }[] = [
  { value: "authorization_code", label: "Authorization Code" },
  { value: "client_credentials", label: "Client Credentials" },
  { value: "password", label: "Password" },
  { value: "implicit", label: "Implicit (legacy)" },
];

function parseScopes(s: string): string[] {
  return s.split(/[, ]+/).map((t) => t.trim()).filter(Boolean);
}

function expiryLabel(expiresAt?: number, scope?: string): string {
  if (expiresAt === undefined) return scope ? `scope: ${scope}` : "no expiry";
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `expires in ${m > 0 ? `${m}m ` : ""}${s}s${scope ? ` · scope: ${scope}` : ""}`;
}

function OAuth2Editor({ auth, onChange }: { auth: AuthConfig; onChange: (a: AuthConfig) => void }) {
  const o2 = auth.oauth2;
  const [codeInput, setCodeInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const grant = o2?.grantType ?? "authorization_code";
  const patch = (changes: Partial<NonNullable<AuthConfig["oauth2"]>>) =>
    onChange({ ...auth, oauth2: { grantType: grant, ...o2, ...changes } });
  const clearError = () => setError(null);

  const needsTokenUrl = grant !== "implicit";
  const awaitingCode = grant === "authorization_code" && Boolean(o2?.state);

  async function withTransport<T>(fn: (transport: OAuth2Transport) => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const { getTransport } = await import("@knockport/transport");
      const s = useAppStore.getState();
      return await fn(getTransport({ useRelay: s.useRelay, relayUrl: s.relayUrl, relayToken: s.relayToken }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function storeTokenOn(stored: { accessToken: string; refreshToken?: string; tokenType: string; expiresAt?: number; scope?: string }) {
    patch({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      tokenType: stored.tokenType,
      expiresAt: stored.expiresAt,
      scope: stored.scope,
    });
  }

  function beginAuthorize() {
    if (!o2?.authUrl) {
      setError("Authorization URL is required");
      return;
    }
    const start = startAuthorize({
      authUrl: o2.authUrl,
      clientId: o2.clientId ?? "",
      redirectUri: o2.redirectUri,
      scopes: o2.scopes ?? [],
      pkce: grant === "authorization_code" ? (o2.pkce ?? true) : false,
      responseType: grant === "implicit" ? "token" : "code",
    });
    patch({ codeVerifier: start.codeVerifier, state: start.state });
    setCodeInput("");
    window.open(start.url, "_blank", "noopener");
  }

  async function submitCode() {
    if (!codeInput.trim() || !o2) return;
    const stored = await withTransport((transport) =>
      exchangeCode({
        code: codeInput.trim(),
        tokenUrl: o2.tokenUrl ?? "",
        clientId: o2.clientId ?? "",
        clientSecret: o2.clientSecret,
        redirectUri: o2.redirectUri,
        codeVerifier: o2.codeVerifier,
        authMethod: o2.authMethod,
        transport,
      }),
    );
    if (stored) {
      // Single patch: onChange is called per patch, and two sequential
      // patches share the same stale snapshot — merge them.
      patch({
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        tokenType: stored.tokenType,
        expiresAt: stored.expiresAt,
        scope: stored.scope,
        codeVerifier: undefined,
        state: undefined,
      });
      setCodeInput("");
    }
  }

  async function directFetch() {
    if (!o2) return;
    const stored = await withTransport((transport) =>
      fetchAccessToken({
        grantType: grant as "client_credentials" | "password",
        tokenUrl: o2.tokenUrl ?? "",
        clientId: o2.clientId ?? "",
        clientSecret: o2.clientSecret,
        username: o2.username,
        password: o2.password,
        authMethod: o2.authMethod,
        transport,
      }),
    );
    if (stored) storeTokenOn(stored);
  }

  async function doRefresh() {
    if (!o2?.refreshToken || !o2?.tokenUrl) return;
    const stored = await withTransport((transport) =>
      refreshAccessToken({
        refreshToken: o2.refreshToken!,
        tokenUrl: o2.tokenUrl!,
        clientId: o2.clientId ?? "",
        clientSecret: o2.clientSecret,
        authMethod: o2.authMethod,
        scopes: o2.scopes ?? [],
        transport,
      }),
    );
    if (stored) storeTokenOn(stored);
  }

  const expired = o2?.accessToken ? isTokenExpired({
    accessToken: o2.accessToken,
    tokenType: o2.tokenType ?? "Bearer",
    expiresAt: o2.expiresAt,
  }) : false;

  return (
    <div className="kp-oauth-editor">
      <div className="kp-field">
        <label>Grant Type</label>
        <select
          value={grant}
          onChange={(e) => {
            patch({ grantType: e.target.value as OAuth2GrantType, codeVerifier: undefined, state: undefined });
            clearError();
          }}
        >
          {GRANTS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>

      {(grant === "authorization_code" || grant === "implicit") && (
        <>
          <div className="kp-field">
            <label>Authorization URL</label>
            <input
              type="text"
              className="kp-mono"
              value={o2?.authUrl ?? ""}
              placeholder="https://…/authorize"
              onChange={(e) => patch({ authUrl: e.target.value })}
            />
          </div>
          <div className="kp-field">
            <label>Callback URL (redirect URI)</label>
            <input
              type="text"
              className="kp-mono"
              value={o2?.redirectUri ?? ""}
              placeholder="https://…/callback (optional)"
              onChange={(e) => patch({ redirectUri: e.target.value })}
            />
          </div>
          {grant === "authorization_code" && (
            <div className="kp-field">
              <label className="kp-inline-label">
                <input
                  type="checkbox"
                  className="kp-checkbox"
                  checked={o2?.pkce ?? true}
                  onChange={(e) => patch({ pkce: e.target.checked })}
                />
                PKCE (S256 code challenge, RFC 7636)
              </label>
            </div>
          )}
        </>
      )}

      {grant === "password" && (
        <div className="kp-field-grid">
          <div className="kp-field">
            <label>Username</label>
            <input
              type="text"
              value={o2?.username ?? ""}
              onChange={(e) => patch({ username: e.target.value })}
            />
          </div>
          <div className="kp-field">
            <label>Password</label>
            <input
              type="password"
              value={o2?.password ?? ""}
              onChange={(e) => patch({ password: e.target.value })}
            />
          </div>
        </div>
      )}

      {needsTokenUrl && (
        <>
          <div className="kp-field">
            <label>Token URL</label>
            <input
              type="text"
              className="kp-mono"
              value={o2?.tokenUrl ?? ""}
              placeholder="https://…/token"
              onChange={(e) => patch({ tokenUrl: e.target.value })}
            />
          </div>
          <div className="kp-field-grid">
            <div className="kp-field">
              <label>Client ID</label>
              <input
                type="text"
                value={o2?.clientId ?? ""}
                onChange={(e) => patch({ clientId: e.target.value })}
              />
            </div>
            <div className="kp-field">
              <label>Client Secret</label>
              <div className="kp-reveal-row">
                <input
                  type={showSecret ? "text" : "password"}
                  value={o2?.clientSecret ?? ""}
                  placeholder="optional for public clients"
                  onChange={(e) => patch({ clientSecret: e.target.value })}
                />
                <button type="button" className="kp-icon-btn" onClick={() => setShowSecret(!showSecret)}>
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
          <div className="kp-field">
            <label>Scope</label>
            <input
              type="text"
              className="kp-mono"
              value={(o2?.scopes ?? []).join(" ")}
              placeholder="read write (space separated)"
              onChange={(e) => patch({ scopes: parseScopes(e.target.value) })}
            />
          </div>
        </>
      )}

      <details className="kp-oauth-advanced">
        <summary>Advanced</summary>
        <div className="kp-field-grid">
          <div className="kp-field">
            <label>Client Authentication</label>
            <select value={o2?.authMethod ?? "basic"} onChange={(e) => patch({ authMethod: e.target.value as "basic" | "post_body" })}>
              <option value="basic">Basic auth header</option>
              <option value="post_body">Send in request body</option>
            </select>
          </div>
          <div className="kp-field">
            <label>Send token as</label>
            <select value={o2?.sendTokenIn ?? "header"} onChange={(e) => patch({ sendTokenIn: e.target.value as "header" | "query" })}>
              <option value="header">Header (Authorization)</option>
              <option value="query">Query parameter</option>
            </select>
          </div>
          {(o2?.sendTokenIn ?? "header") === "header" ? (
            <div className="kp-field">
              <label>Header prefix</label>
              <input
                type="text"
                className="kp-mono"
                value={o2?.headerPrefix ?? ""}
                placeholder="Bearer (default)"
                onChange={(e) => patch({ headerPrefix: e.target.value })}
              />
            </div>
          ) : (
            <div className="kp-field">
              <label>Query param name</label>
              <input
                type="text"
                className="kp-mono"
                value={o2?.queryParamName ?? ""}
                placeholder="access_token (default)"
                onChange={(e) => patch({ queryParamName: e.target.value })}
              />
            </div>
          )}
          <div className="kp-field">
            <label className="kp-inline-label">
              <input
                type="checkbox"
                className="kp-checkbox"
                checked={o2?.useIdToken ?? false}
                onChange={(e) => patch({ useIdToken: e.target.checked })}
              />
              Use id_token (OIDC) instead of access_token
            </label>
          </div>
        </div>
      </details>

      <div className="kp-oauth-actions">
        {grant === "authorization_code" && !awaitingCode && (
          <button type="button" className="kp-btn primary" disabled={busy || !o2?.authUrl} onClick={beginAuthorize}>
            Fetch New Token
          </button>
        )}
        {grant === "implicit" && (
          <button type="button" className="kp-btn primary" disabled={busy || !o2?.authUrl} onClick={beginAuthorize}>
            Fetch New Token
          </button>
        )}
        {(grant === "client_credentials" || grant === "password") && (
          <button type="button" className="kp-btn primary" disabled={busy || !o2?.tokenUrl} onClick={directFetch}>
            Fetch New Token
          </button>
        )}
        {grant === "implicit" && <p className="kp-hint">Implicit flow returns the token in the URL fragment — start the flow, then paste the returned <code className="kp-mono">access_token</code> into the token field below.</p>}
        {o2?.accessToken && o2.refreshToken && o2.tokenUrl && (
          <button type="button" className="kp-btn secondary" disabled={busy} onClick={doRefresh}>
            <RefreshCw size={13} /> Refresh Token
          </button>
        )}
        {o2?.accessToken && (
          <button
            type="button"
            className="kp-btn"
            onClick={() =>
              patch({ accessToken: undefined, refreshToken: undefined, tokenType: undefined, expiresAt: undefined, scope: undefined })
            }
          >
            Clear Token
          </button>
        )}
      </div>

      {awaitingCode && (
        <div className="kp-oauth-code-exchange">
          <p className="kp-hint">
            Authorize in the opened tab, then paste the returned <code className="kp-mono">code</code> (from the callback URL) below.
          </p>
          <div className="kp-reveal-row">
            <input
              type="text"
              className="kp-mono"
              placeholder="authorization code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
            />
            <button type="button" className="kp-btn primary" disabled={busy || !codeInput.trim()} onClick={submitCode}>
              Exchange
            </button>
            <button type="button" className="kp-btn" onClick={() => patch({ codeVerifier: undefined, state: undefined })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {grant === "implicit" && (
        <div className="kp-oauth-code-exchange">
          <div className="kp-reveal-row">
            <input
              type="text"
              className="kp-mono"
              placeholder="access_token from URL fragment"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button
              type="button"
              className="kp-btn primary"
              disabled={!tokenInput.trim()}
              onClick={() => {
                patch({
                  accessToken: tokenInput.trim(),
                  tokenType: o2?.tokenType ?? "Bearer",
                  expiresAt: undefined,
                  codeVerifier: undefined,
                  state: undefined,
                });
                setTokenInput("");
              }}
            >
              Use Token
            </button>
          </div>
        </div>
      )}

      {o2?.accessToken && (
        <div className="kp-token-view">
          <div className="kp-token-view-head">
            <span className={`kp-token-badge${expired ? " expired" : ""}`}>{expired ? "Expired" : "Active"}</span>
            <span className="kp-hint">{expiryLabel(o2.expiresAt, o2.scope)}</span>
            <span className="kp-hint">{o2.tokenType ?? "Bearer"}</span>
            <button type="button" className="kp-icon-btn" onClick={() => setShowToken(!showToken)}>
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="kp-mono kp-token-value">{showToken ? o2.accessToken : "••••••••••••••••"}</div>
        </div>
      )}

      {error && <p className="kp-hint kp-error-text">{error}</p>}
    </div>
  );
}

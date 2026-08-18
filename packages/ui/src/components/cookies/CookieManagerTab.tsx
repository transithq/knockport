import type { StoredCookie } from "@knockport/core";
import { Check, Cookie, Eraser, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../../store/app-store";

// ── Cookie Manager (G2) ──────────────────────────────────────────────────────
// Full-area tab browsing the persistent cookie jar grouped by domain, with
// inline edit/delete (editors are full-area tabs — never modals).

interface EditState {
  identity: string;
  domain: string;
  path: string;
  key: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  expires: string;
}

function expiryToLocal(expires?: number): string {
  if (expires === undefined) return "";
  const d = new Date(expires);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToExpiry(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? undefined : t;
}

function groupByDomain(cookies: StoredCookie[]): [string, StoredCookie[]][] {
  const byDomain = new Map<string, StoredCookie[]>();
  for (const c of cookies) {
    const list = byDomain.get(c.domain) ?? [];
    list.push(c);
    byDomain.set(c.domain, list);
  }
  return [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function CookieRow({
  cookie,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  cookie: StoredCookie;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (next: EditState) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<EditState>(() => ({
    identity: `${cookie.domain}|${cookie.path}|${cookie.key}`,
    domain: cookie.domain,
    path: cookie.path,
    key: cookie.key,
    value: cookie.value,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    expires: expiryToLocal(cookie.expires),
  }));

  if (editing) {
    return (
      <div className="kp-cookie-row kp-cookie-row-editing">
        <div className="kp-cookie-edit-grid">
          <label>
            Name
            <input
              className="kp-text-input kp-mono"
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
          </label>
          <label>
            Value
            <input
              className="kp-text-input kp-mono"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            />
          </label>
          <label>
            Path
            <input
              className="kp-text-input kp-mono"
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value || "/" })}
            />
          </label>
          <label>
            Expires (empty = session)
            <input
              className="kp-text-input kp-mono"
              type="datetime-local"
              value={draft.expires}
              onChange={(e) => setDraft({ ...draft, expires: e.target.value })}
            />
          </label>
        </div>
        <div className="kp-cookie-edit-flags">
          <label className="kp-cookie-flag">
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={draft.secure}
              onChange={(e) => setDraft({ ...draft, secure: e.target.checked })}
            />
            Secure
          </label>
          <label className="kp-cookie-flag">
            <input
              type="checkbox"
              className="kp-checkbox"
              checked={draft.httpOnly}
              onChange={(e) => setDraft({ ...draft, httpOnly: e.target.checked })}
            />
            HttpOnly
          </label>
        </div>
        <div className="kp-cookie-row-actions">
          <button type="button" className="kp-icon-btn kp-icon-btn-ok" title="Save" onClick={() => onSave(draft)}>
            <Check size={14} />
          </button>
          <button type="button" className="kp-icon-btn" title="Cancel" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  const attrs: string[] = [];
  if (cookie.path !== "/") attrs.push(`path=${cookie.path}`);
  if (cookie.secure) attrs.push("secure");
  if (cookie.httpOnly) attrs.push("httpOnly");
  if (cookie.sameSite) attrs.push(`sameSite=${cookie.sameSite}`);
  if (cookie.expires !== undefined) attrs.push(`expires=${new Date(cookie.expires).toLocaleString()}`);
  else attrs.push("session");

  return (
    <div className="kp-cookie-row">
      <div className="kp-cookie-cell kp-cookie-key kp-mono">{cookie.key}</div>
      <div className="kp-cookie-cell kp-cookie-cell-val kp-mono" title={cookie.value}>
        {cookie.value}
      </div>
      <div className="kp-cookie-cell kp-cookie-cell-attrs">
        {attrs.map((a) => (
          <span className="kp-cookie-attr" key={a}>
            {a}
          </span>
        ))}
      </div>
      <div className="kp-cookie-row-actions">
        <button type="button" className="kp-icon-btn" title="Edit cookie" onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="kp-icon-btn kp-icon-btn-danger"
          title="Delete cookie"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function CookieManagerTab() {
  const jar = useAppStore((s) => s.cookieJar);
  const updateCookie = useAppStore((s) => s.updateCookie);
  const setCookie = useAppStore((s) => s.setCookie);
  const deleteCookie = useAppStore((s) => s.deleteCookie);
  const clearCookieDomain = useAppStore((s) => s.clearCookieDomain);
  const clearCookieJar = useAppStore((s) => s.clearCookieJar);

  const [editingIdentity, setEditingIdentity] = useState<string | null>(null);
  const [addingDomain, setAddingDomain] = useState<string>("");

  const groups = useMemo(() => groupByDomain(jar.all()), [jar]);
  const total = jar.count();

  const saveEdit = (draft: EditState) => {
    if (!draft.key.trim()) return;
    const now = Date.now();
    updateCookie({
      key: draft.key,
      value: draft.value,
      domain: draft.domain,
      hostOnly: true,
      path: draft.path || "/",
      secure: draft.secure,
      httpOnly: draft.httpOnly,
      expires: localToExpiry(draft.expires),
      created: now,
      lastAccessed: now,
    });
    setEditingIdentity(null);
  };

  const addCookie = () => {
    const domain = addingDomain.trim().toLowerCase();
    if (!domain) return;
    setCookie(`https://${domain}/`, { key: "new_cookie", value: "", path: "/" });
    setAddingDomain("");
  };

  return (
    <div className="kp-settings-page kp-cookie-manager kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <Cookie size={17} />
        </span>
        <h1 className="kp-settings-title">Cookie Jar</h1>
      </div>
      <p className="kp-hint">
        Cookies captured from responses, stored per domain, and re-attached to subsequent sends.
      </p>

      <div className="kp-cookie-toolbar">
        <div className="kp-cookie-add">
          <input
            className="kp-text-input kp-mono"
            placeholder="Add cookie for domain… e.g. api.example.com"
            value={addingDomain}
            onChange={(e) => setAddingDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCookie();
            }}
          />
          <button type="button" className="kp-btn secondary" onClick={addCookie} title="Add cookie">
            <Plus size={14} /> Add
          </button>
        </div>
        <button
          type="button"
          className="kp-btn danger"
          onClick={clearCookieJar}
          disabled={total === 0}
          title="Remove every stored cookie"
        >
          <Eraser size={14} /> Clear All ({total})
        </button>
      </div>

      {groups.length === 0 && (
        <p className="kp-hint">
          No cookies stored yet. Send a request that returns Set-Cookie headers and they will appear
          here, automatically attached to later requests for the same domain.
        </p>
      )}

      {groups.map(([domain, cookies]) => (
        <div className="kp-cookie-domain" key={domain}>
          <div className="kp-cookie-domain-head">
            <span className="kp-cookie-domain-name kp-mono">{domain}</span>
            <span className="kp-cookie-domain-count">{cookies.length} cookie{cookies.length === 1 ? "" : "s"}</span>
            <button
              type="button"
              className="kp-btn small danger"
              onClick={() => clearCookieDomain(domain)}
              title={`Clear all cookies for ${domain}`}
            >
              Clear
            </button>
          </div>
          <div className="kp-cookie-table">
            {cookies.map((c) => {
              const identity = `${c.domain}|${c.path}|${c.key}`;
              return (
                <CookieRow
                  key={identity}
                  cookie={c}
                  editing={editingIdentity === identity}
                  onEdit={() => setEditingIdentity(identity)}
                  onCancel={() => setEditingIdentity(null)}
                  onSave={saveEdit}
                  onDelete={() => deleteCookie(c.domain, c.path, c.key)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
import { createId } from "@knockport/core";
import { Copy, Play, Plug, Plus, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";

// ── Mock Servers workspace tab ───────────────────────────────────────────────
// Hoppscotch-style mocks: servers hold routes (method, path pattern, status,
// body, delay). Starting a server registers its routes with the relay
// (POST /mock/register) and serves them at {relayUrl}/mock/{id}/* — the only
// place a browser app can expose real HTTP endpoints. Definitions persist in
// localStorage; registrations re-arm automatically on tab mount (the relay
// keeps them in memory only).

export interface MockRouteDef {
  id: string;
  method: string;
  path: string;
  status: number;
  contentType: string;
  body: string;
  delayMs: number;
}

export interface MockServerDef {
  id: string;
  name: string;
  running: boolean;
  routes: MockRouteDef[];
}

const SERVERS_KEY = "kp-mock-servers";

function loadServers(): MockServerDef[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    return raw ? (JSON.parse(raw) as MockServerDef[]) : [];
  } catch {
    return [];
  }
}

function saveServers(list: MockServerDef[]) {
  try {
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function newRoute(): MockRouteDef {
  return {
    id: createId("mroute"),
    method: "GET",
    path: "/hello",
    status: 200,
    contentType: "application/json",
    body: '{\n  "message": "hello from mock"\n}',
    delayMs: 0,
  };
}

export function MockTab() {
  const [servers, setServers] = useState<MockServerDef[]>(loadServers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const relayUrl = useAppStore((s) => s.relayUrl);
  const relayToken = useAppStore((s) => s.relayToken);
  const useRelay = useAppStore((s) => s.useRelay);

  const persist = (next: MockServerDef[]) => {
    setServers(next);
    saveServers(next);
  };

  const patchServer = (id: string, changes: Partial<MockServerDef>) =>
    persist(servers.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const patchRoute = (serverId: string, routeId: string, changes: Partial<MockRouteDef>) =>
    persist(
      servers.map((s) =>
        s.id === serverId
          ? { ...s, routes: s.routes.map((r) => (r.id === routeId ? { ...r, ...changes } : r)) }
          : s,
      ),
    );

  const register = async (server: MockServerDef): Promise<boolean> => {
    const res = await fetch(`${relayUrl.replace(/\/+$/, "")}/mock/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(relayToken ? { authorization: `Bearer ${relayToken}` } : {}),
      },
      body: JSON.stringify({
        id: server.id,
        routes: server.routes.map((r) => ({
          method: r.method,
          path: r.path,
          status: r.status,
          body: r.body,
          content_type: r.contentType,
          delay_ms: r.delayMs,
        })),
      }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(detail.error ?? `relay ${res.status}`);
    }
    return true;
  };

  const unregister = async (id: string) => {
    await fetch(`${relayUrl.replace(/\/+$/, "")}/mock/${id}`, {
      method: "DELETE",
      headers: relayToken ? { authorization: `Bearer ${relayToken}` } : {},
    }).catch(() => undefined);
  };

  const start = async (server: MockServerDef) => {
    setError(null);
    try {
      await register(server);
      patchServer(server.id, { running: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start mock server");
    }
  };

  const stop = async (server: MockServerDef) => {
    await unregister(server.id);
    patchServer(server.id, { running: false });
  };

  // Re-arm servers that were running when the tab last closed — the relay
  // keeps registrations in memory only, so restarts wipe them.
  useEffect(() => {
    const running = servers.filter((s) => s.running && s.routes.length > 0);
    if (running.length === 0 || !useRelay) return;
    (async () => {
      for (const s of running) {
        try {
          await register(s);
        } catch {
          patchServer(s.id, { running: false });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createServer = () => {
    const server: MockServerDef = {
      id: createId("mock"),
      name: `Mock ${servers.length + 1}`,
      running: false,
      routes: [newRoute()],
    };
    persist([...servers, server]);
    setSelectedId(server.id);
  };

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  const copyUrl = async (server: MockServerDef) => {
    try {
      await navigator.clipboard.writeText(`${relayUrl.replace(/\/+$/, "")}/mock/${server.id}/`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="kp-settings-page kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <Plug size={17} />
        </span>
        <h1 className="kp-settings-title">Mock Servers</h1>
        <button type="button" className="kp-btn primary" onClick={createServer}>
          <Plus size={14} /> New Mock Server
        </button>
      </div>
      <p className="kp-hint">
        Routes are served by the relay at <span className="kp-mono">{"{relay}/mock/{id}/"}</span> —
        start a server and point requests at it.
        {!useRelay && " Enable the relay in Settings first."}
      </p>

      {error && <p className="kp-api-error">{error}</p>}

      {servers.length === 0 && <p className="kp-hint">No mock servers yet.</p>}

      <div className="kp-api-list">
        {servers.map((server) => (
          <div
            key={server.id}
            className={clsx("kp-api-spec-card", server.id === selectedId && "active")}
            onClick={() => setSelectedId(server.id === selectedId ? null : server.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setSelectedId(server.id === selectedId ? null : server.id)}
          >
            <span
              className="kp-online-dot"
              style={{ background: server.running ? "var(--kp-success)" : "var(--kp-text-muted)" }}
            />
            <span className="kp-api-spec-name kp-truncate">{server.name}</span>
            <span className="kp-chip">{server.routes.length} routes</span>
            {server.running && (
              <span
                className="kp-icon-btn"
                title="Copy base URL"
                onClick={(e) => {
                  e.stopPropagation();
                  copyUrl(server);
                }}
              >
                <Copy size={13} />
              </span>
            )}
            {server.running ? (
              <button
                type="button"
                className="kp-btn secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  stop(server);
                }}
              >
                <Square size={12} /> Stop
              </button>
            ) : (
              <button
                type="button"
                className="kp-btn primary"
                disabled={!useRelay}
                onClick={(e) => {
                  e.stopPropagation();
                  start(server);
                }}
              >
                <Play size={12} /> Start
              </button>
            )}
            <span
              className="kp-icon-btn"
              title="Delete server"
              onClick={async (e) => {
                e.stopPropagation();
                if (server.running) await unregister(server.id);
                persist(servers.filter((s) => s.id !== server.id));
                if (selectedId === server.id) setSelectedId(null);
              }}
            >
              <Trash2 size={13} />
            </span>
          </div>
        ))}
      </div>

      {selected && (
        <div className="kp-settings-section">
          <div className="kp-api-spec-head">
            <h2>{selected.name}</h2>
            {selected.running && (
              <span className="kp-chip kp-mono">
                {copied ? "copied!" : `${relayUrl.replace(/\/+$/, "")}/mock/${selected.id}/`}
              </span>
            )}
          </div>

          <div className="kp-setting-row">
            <label>Name</label>
            <input
              type="text"
              className="kp-text-input"
              style={{ flex: 1 }}
              value={selected.name}
              onChange={(e) => patchServer(selected.id, { name: e.target.value })}
            />
          </div>

          <div className="kp-kv-table kp-mock-routes">
            {selected.routes.map((route) => (
              <div key={route.id} className="kp-mock-route">
                <div className="kp-kv-row">
                  <select
                    className="kp-text-input kp-mock-method"
                    value={route.method}
                    onChange={(e) => patchRoute(selected.id, route.id, { method: e.target.value })}
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="kp-text-input kp-mono"
                    value={route.path}
                    placeholder="/users/:id"
                    onChange={(e) => patchRoute(selected.id, route.id, { path: e.target.value })}
                  />
                  <input
                    type="number"
                    className="kp-num-input kp-mock-status"
                    min={100}
                    max={599}
                    value={route.status}
                    onChange={(e) =>
                      patchRoute(selected.id, route.id, {
                        status: Number.parseInt(e.target.value, 10) || 200,
                      })
                    }
                  />
                  <input
                    type="number"
                    className="kp-num-input kp-mock-delay"
                    min={0}
                    step={100}
                    title="Delay (ms)"
                    value={route.delayMs}
                    onChange={(e) =>
                      patchRoute(selected.id, route.id, {
                        delayMs: Number.parseInt(e.target.value, 10) || 0,
                      })
                    }
                  />
                  <span
                    className="kp-icon-btn"
                    title="Delete route"
                    onClick={() =>
                      patchServer(selected.id, {
                        routes: selected.routes.filter((r) => r.id !== route.id),
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </span>
                </div>
                <div className="kp-mock-route-detail">
                  <input
                    type="text"
                    className="kp-text-input kp-mono kp-mock-ct"
                    placeholder="content type (application/json)"
                    value={route.contentType}
                    onChange={(e) => patchRoute(selected.id, route.id, { contentType: e.target.value })}
                  />
                  <textarea
                    className="kp-text-input kp-mono kp-api-textarea"
                    placeholder="response body"
                    value={route.body}
                    spellCheck={false}
                    onChange={(e) => patchRoute(selected.id, route.id, { body: e.target.value })}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              className="kp-btn secondary"
              onClick={() => patchServer(selected.id, { routes: [...selected.routes, newRoute()] })}
            >
              <Plus size={13} /> Add route
            </button>
          </div>
          {selected.running && (
            <p className="kp-hint">
              Serving at <span className="kp-mono">{relayUrl.replace(/\/+$/, "")}/mock/{selected.id}/</span> —
              e.g. <span className="kp-mono">{relayUrl.replace(/\/+$/, "")}/mock/{selected.id}{selected.routes[0]?.path ?? "/"}</span>.
              Route edits apply on next Start.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

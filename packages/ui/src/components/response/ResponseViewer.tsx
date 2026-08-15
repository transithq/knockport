import React from "react";
import { useAppStore, type ResponsePanel as ResponsePanelType } from "../../store/app-store";
import { Tabs, Badge } from "../common/primitives";
import { clsx } from "clsx";

// ── Response Viewer ──────────────────────────────────────────────────────────
export function ResponseViewer() {
  const { activeTabId, responses, activeResponsePanel, setActiveResponsePanel } = useAppStore();

  const response = activeTabId ? responses[activeTabId] : null;

  if (!response) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--kp-text-muted)]">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <p className="text-sm mt-3">Send a request to see the response</p>
      </div>
    );
  }

  const statusVariant = getStatusVariant(response.status);
  const responseTabs = [
    { id: "pretty", label: "Pretty" },
    { id: "raw", label: "Raw" },
    { id: "headers", label: "Headers", count: Object.keys(response.headers).length },
    { id: "cookies", label: "Cookies", count: response.cookies.length || undefined },
    { id: "timings", label: "Timings" },
  ];

  return (
    <div className="flex flex-col h-full border-l border-[var(--kp-border-primary)]">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--kp-border-primary)]">
        <Badge variant={statusVariant}>
          {response.status} {response.statusText}
        </Badge>
        <span className="text-xs text-[var(--kp-text-secondary)] kp-mono">
          {response.timings.total.toFixed(0)} ms
        </span>
        <span className="text-xs text-[var(--kp-text-secondary)]">
          {formatBytes(response.bodySize)}
        </span>
        <span className="text-xs text-[var(--kp-text-muted)] ml-auto">
          {formatTimestamp(response.timestamp)}
        </span>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <Tabs
          tabs={responseTabs}
          active={activeResponsePanel}
          onChange={(id) => setActiveResponsePanel(id as ResponsePanelType)}
        />
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-auto p-4">
        {activeResponsePanel === "pretty" && <PrettyBody body={response.body} contentType={response.contentType} />}
        {activeResponsePanel === "raw" && <RawBody body={response.body} />}
        {activeResponsePanel === "headers" && <HeadersView headers={response.headers} />}
        {activeResponsePanel === "cookies" && <CookiesView cookies={response.cookies} />}
        {activeResponsePanel === "timings" && <TimingsView timings={response.timings} />}
      </div>
    </div>
  );
}

// ── Pretty Body ──────────────────────────────────────────────────────────────
function PrettyBody({ body, contentType }: { body: string; contentType?: string }) {
  const isJson = contentType?.includes("json") || isJsonString(body);
  const formatted = isJson ? formatJson(body) : body;

  return (
    <div className="relative">
      {isJson && (
        <div className="absolute top-0 right-0 text-[10px] text-[var(--kp-text-muted)] px-2 py-1">
          JSON
        </div>
      )}
      <pre className="text-xs font-mono text-[var(--kp-text-primary)] whitespace-pre-wrap break-words leading-relaxed">
        {formatted || "(empty response)"}
      </pre>
    </div>
  );
}

// ── Raw Body ─────────────────────────────────────────────────────────────────
function RawBody({ body }: { body: string }) {
  return (
    <pre className="text-xs font-mono text-[var(--kp-text-secondary)] whitespace-pre-wrap break-words">
      {body || "(empty response)"}
    </pre>
  );
}

// ── Headers View ─────────────────────────────────────────────────────────────
function HeadersView({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);

  if (!entries.length) {
    return <p className="text-xs text-[var(--kp-text-muted)]">No headers</p>;
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[180px_1fr] gap-2 py-1 px-2 rounded hover:bg-[var(--kp-bg-hover)] text-xs"
        >
          <span className="text-[var(--kp-text-secondary)] font-medium kp-mono truncate">
            {key}
          </span>
          <span className="text-[var(--kp-text-primary)] kp-mono break-all">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Cookies View ─────────────────────────────────────────────────────────────
function CookiesView({ cookies }: { cookies: import("@knockport/core").ResponseCookie[] }) {
  if (!cookies.length) {
    return <p className="text-xs text-[var(--kp-text-muted)]">No cookies</p>;
  }

  return (
    <div className="space-y-2">
      {cookies.map((cookie) => (
        <div
          key={cookie.name}
          className="p-2 rounded-md border border-[var(--kp-border-primary)] space-y-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--kp-text-primary)] kp-mono">
              {cookie.name}
            </span>
            <span className="text-xs text-[var(--kp-text-secondary)] kp-mono truncate">
              {cookie.value}
            </span>
          </div>
          <div className="flex gap-2">
            {cookie.httpOnly && <Badge variant="warning">HttpOnly</Badge>}
            {cookie.secure && <Badge variant="success">Secure</Badge>}
            {cookie.path && <Badge>{cookie.path}</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Timings View ─────────────────────────────────────────────────────────────
function TimingsView({ timings }: { timings: import("@knockport/core").ResponseTimings }) {
  const items = [
    { label: "DNS Lookup", value: timings.dns, color: "var(--kp-info)" },
    { label: "TCP Connect", value: timings.tcp, color: "var(--kp-warning)" },
    { label: "TLS Handshake", value: timings.tls, color: "var(--kp-purple-400)" },
    { label: "Time to First Byte", value: timings.ttfb, color: "var(--kp-success)" },
    { label: "Download", value: timings.download, color: "var(--kp-accent)" },
    { label: "Redirect", value: timings.redirect, color: "var(--kp-text-tertiary)" },
    { label: "Total", value: timings.total, color: "var(--kp-text-primary)" },
  ];

  const maxTime = Math.max(...items.map((i) => i.value ?? 0), 1);

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--kp-text-secondary)]">{item.label}</span>
            <span className="kp-mono text-[var(--kp-text-primary)]">
              {item.value !== undefined ? `${item.value.toFixed(1)} ms` : "—"}
            </span>
          </div>
          {item.value !== undefined && item.value > 0 && (
            <div className="h-1.5 bg-[var(--kp-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min((item.value / maxTime) * 100, 100)}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getStatusVariant(status: number): "success" | "warning" | "error" | "info" {
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "info";
  if (status >= 400 && status < 500) return "warning";
  return "error";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isJsonString(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

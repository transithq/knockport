import { useMemo } from "react";
import { Check, MoreHorizontal, Download } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { downloadResponseText, filenameForResponse } from "./response-export";

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "var(--kp-status-2xx)";
  if (status >= 300 && status < 400) return "var(--kp-status-3xx)";
  if (status >= 400 && status < 500) return "var(--kp-status-4xx)";
  return "var(--kp-status-5xx)";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

/** Milliseconds rounded to at most 3 decimal places (trailing zeros dropped). */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "0";
  return String(Math.round(ms * 1000) / 1000);
}

/** Relative time label for the response timestamp. */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Just now";
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Sparkline chart (SVG) ────────────────────────────────────────────────────
function Sparkline({ value }: { value: string }) {
  const points = useMemo(() => {
    // Deterministic pseudo-random series ending near the current value
    const n = 48;
    const pts: number[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < n; i++) {
      const base = 0.4 + 0.2 * Math.sin(i / 5) + (rand() - 0.5) * 0.3;
      pts.push(Math.max(0.05, Math.min(0.95, base)));
    }
    return pts;
  }, []);

  const w = 300;
  const h = 70;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - p * h).toFixed(1)}`)
    .join(" ");

  return (
    <div className="kp-chart">
        <div className="kp-chart-value">{value} ms</div>
      <div className="kp-chart-body">
        <div className="kp-chart-yaxis">
          <span>500ms</span>
          <span>250ms</span>
          <span>0ms</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="kp-chart-svg">
          <path d={path} fill="none" stroke="var(--kp-accent)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="kp-chart-xaxis">
        <span>-60s</span><span>-45s</span><span>-30s</span><span>-15s</span><span>Now</span>
      </div>
    </div>
  );
}

// ── Response Summary (right column) ──────────────────────────────────────────
export function ResponseSummary({ tabId }: { tabId: string }) {
  const responses = useAppStore((s) => s.responses);
  const requestUrl = useAppStore((s) => s.requests[tabId]?.url ?? "");
  const response = responses[tabId];
  const [saved, setSaved] = useState(false);

  const saveBody = () => {
    if (!response) return;
    const name = filenameForResponse(response.url ?? requestUrl, response.contentType, response.body);
    downloadResponseText(response.body, name, response.contentType);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!response) {
    return (
      <div className="kp-response-summary">
        <div className="kp-empty-center">
          <p className="kp-empty-sub">Response analytics appear here</p>
        </div>
      </div>
    );
  }

  const headers = Object.entries(response.headers);

  return (
    <div className="kp-response-summary kp-scroll">
      {/* Status bar */}
      <div className="kp-summary-statusbar">
        <span className="kp-status-code" style={{ color: statusColor(response.status) }}>
          {response.status} {response.statusText}
        </span>
        <span className="kp-summary-dot">•</span>
        <span>{formatMs(response.timings.total)} ms</span>
        <span className="kp-summary-dot">•</span>
        <span>{formatSize(response.bodySize)}</span>
        <span className="kp-status-right">
          <span className="kp-summary-time">{timeAgo(response.timestamp)}</span>
          <button type="button" className="kp-icon-btn" title="Save response body" onClick={saveBody}>
            {saved ? <Check size={13} /> : <Download size={13} />}
          </button>
          <button type="button" className="kp-icon-btn" title="More"><MoreHorizontal size={13} /></button>
        </span>
      </div>

      {/* Response time card */}
      <div className="kp-card">
        <div className="kp-card-title">Response Time</div>
        <Sparkline value={formatMs(response.timings.total)} />
      </div>

      {/* Headers card */}
      <div className="kp-card">
        <div className="kp-card-title">Headers ({headers.length})</div>
        <div className="kp-kv-list">
          {headers.slice(0, 8).map(([k, v]) => (
            <div className="kp-kv-list-row" key={k}>
              <span className="kp-kv-key">{k}</span>
              <span className="kp-kv-val kp-mono">{v}</span>
            </div>
          ))}
          {headers.length > 8 && <button type="button" className="kp-link-btn">View all headers</button>}
        </div>
      </div>

      {/* Cookies card */}
      <div className="kp-card">
        <div className="kp-card-title">Cookies ({response.cookies.length})</div>
        <div className="kp-kv-list">
          {response.cookies.length === 0 && <p className="kp-hint">No cookies</p>}
          {response.cookies.map((c) => (
            <div className="kp-kv-list-row" key={c.name}>
              <span className="kp-kv-key">{c.name}</span>
              <span className="kp-kv-val kp-mono">{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

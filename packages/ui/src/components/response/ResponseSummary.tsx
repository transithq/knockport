import { useMemo } from "react";
import { ChevronDown, MoreHorizontal, Download } from "lucide-react";
import { useAppStore } from "../../store/app-store";

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

// ── Sparkline chart (SVG) ────────────────────────────────────────────────────
function Sparkline({ value }: { value: number }) {
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
  const response = responses[tabId];

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
        <span>{response.timings.total} ms</span>
        <span className="kp-summary-dot">•</span>
        <span>{formatSize(response.bodySize)}</span>
        <span className="kp-status-right">
          <button type="button" className="kp-lang-btn">Just now <ChevronDown size={12} /></button>
          <button type="button" className="kp-icon-btn" title="Save"><Download size={13} /></button>
          <button type="button" className="kp-icon-btn" title="More"><MoreHorizontal size={13} /></button>
        </span>
      </div>

      {/* Response time card */}
      <div className="kp-card">
        <div className="kp-card-title">Response Time</div>
        <Sparkline value={response.timings.total} />
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

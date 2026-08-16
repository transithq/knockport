import { clsx } from "clsx";
import { Settings } from "lucide-react";
import { useAppStore } from "../../store/app-store";

// ── Settings Page ────────────────────────────────────────────────────────────
// Global preferences (theme, relay transport, request timeout). Rendered as a
// full-area tab like other editors — never a floating dialog.
export function SettingsPage() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const useRelay = useAppStore((s) => s.useRelay);
  const setUseRelay = useAppStore((s) => s.setUseRelay);
  const relayUrl = useAppStore((s) => s.relayUrl);
  const setRelayUrl = useAppStore((s) => s.setRelayUrl);
  const relayToken = useAppStore((s) => s.relayToken);
  const setRelayToken = useAppStore((s) => s.setRelayToken);
  const timeoutMs = useAppStore((s) => s.timeoutMs);
  const setTimeoutMs = useAppStore((s) => s.setTimeoutMs);

  return (
    <div className="kp-settings-page kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <Settings size={17} />
        </span>
        <h1 className="kp-settings-title">Settings</h1>
      </div>
      <p className="kp-hint">Global preferences apply to every request and run.</p>

      <div className="kp-settings-section">
        <h2>Appearance</h2>
        <div className="kp-setting-row">
          <label>Theme</label>
          <div className="kp-seg-row">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={clsx("kp-seg", theme === t && "active")}
                onClick={() => setTheme(t)}
              >
                {t === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kp-settings-section">
        <h2>Transport</h2>
        <div className="kp-setting-row">
          <label>Send via relay</label>
          <input
            type="checkbox"
            className="kp-checkbox"
            checked={useRelay}
            onChange={(e) => setUseRelay(e.target.checked)}
          />
        </div>

        {useRelay && (
          <>
            <div className="kp-setting-row">
              <label>Relay URL</label>
              <input
                type="text"
                className="kp-text-input kp-mono"
                style={{ flex: 1 }}
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                placeholder="http://localhost:8787"
              />
            </div>
            <div className="kp-setting-row">
              <label>Relay token</label>
              <input
                type="password"
                className="kp-text-input kp-mono"
                style={{ flex: 1 }}
                value={relayToken}
                onChange={(e) => setRelayToken(e.target.value)}
                placeholder="optional — only if the relay sets KP_RELAY_TOKEN"
                autoComplete="off"
              />
            </div>
          </>
        )}

        <p className="kp-hint">
          Relay forwards requests through the standalone Rust service so browser CORS never blocks
          them.
        </p>
      </div>

      <div className="kp-settings-section">
        <h2>Requests</h2>
        <div className="kp-setting-row">
          <label>Timeout (ms)</label>
          <input
            type="number"
            className="kp-num-input"
            min={0}
            step={1000}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number.parseInt(e.target.value, 10) || 30000)}
          />
        </div>
        <p className="kp-hint">The timeout applies to every send, including runner executions.</p>
      </div>
    </div>
  );
}

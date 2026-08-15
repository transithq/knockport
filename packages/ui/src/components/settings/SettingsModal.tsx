import { X } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";

// ── Settings Modal ───────────────────────────────────────────────────────────
// Global preferences (theme, relay transport, request timeout). Replaces the
// per-request Settings tab, which previously held unwired inline controls.
export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const useRelay = useAppStore((s) => s.useRelay);
  const setUseRelay = useAppStore((s) => s.setUseRelay);
  const relayUrl = useAppStore((s) => s.relayUrl);
  const setRelayUrl = useAppStore((s) => s.setRelayUrl);
  const timeoutMs = useAppStore((s) => s.timeoutMs);
  const setTimeoutMs = useAppStore((s) => s.setTimeoutMs);

  if (!open) return null;

  return (
    <div className="kp-cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>Settings</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        </div>

        <div className="kp-settings" style={{ padding: "12px 14px" }}>
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
          )}

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

          <p className="kp-hint">
            Relay forwards requests through the standalone Rust service so browser CORS never
            blocks them. The timeout applies to every send, including runner executions.
          </p>
        </div>
      </div>
    </div>
  );
}

import { ArrowDownToLine, Eraser, Plug, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useAppStore } from "../../store/app-store";

// ── WebSocket workspace tab ──────────────────────────────────────────────────
// Full-area Hoppscotch-style socket client: URL bar + connect, direction/time
// log, composer with recent-message history. State lives in the store so the
// log survives tab switches; the socket instance itself is module-level (a
// live WebSocket can't be serialized into zustand snapshots).

const sockets = new Map<string, WebSocket>();
const SLOT = "singleton";

const RECENT_KEY = "kp-ws-recent";
const RECENT_MAX = 12;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

export function WebSocketTab() {
  const url = useAppStore((s) => s.wsUrl);
  const setWsUrl = useAppStore((s) => s.setWsUrl);
  const status = useAppStore((s) => s.wsStatus);
  const setWsStatus = useAppStore((s) => s.setWsStatus);
  const log = useAppStore((s) => s.wsLog);
  const pushWsLog = useAppStore((s) => s.pushWsLog);
  const clearWsLog = useAppStore((s) => s.clearWsLog);

  const [message, setMessage] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Close the socket when the whole workspace unmounts (app teardown).
  useEffect(() => {
    return () => {
      sockets.get(SLOT)?.close();
      sockets.delete(SLOT);
    };
  }, []);

  const push = (dir: "in" | "out" | "sys", text: string, size?: number) =>
    pushWsLog({ dir, text, time: new Date().toLocaleTimeString(), size });

  const connect = () => {
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      push("sys", "URL must start with ws:// or wss://");
      return;
    }
    sockets.get(SLOT)?.close();
    try {
      const ws = new WebSocket(url);
      sockets.set(SLOT, ws);
      setWsStatus("connecting");
      push("sys", `Connecting to ${url}…`);
      ws.onopen = () => {
        setWsStatus("open");
        push("sys", "Connected");
      };
      ws.onmessage = (e) => {
        const text = typeof e.data === "string" ? e.data : "[binary frame]";
        push("in", text, new Blob([e.data]).size);
      };
      ws.onclose = () => {
        setWsStatus("closed");
        push("sys", "Disconnected");
        sockets.delete(SLOT);
      };
      ws.onerror = () => {
        setWsStatus("error");
        push("sys", "Connection error");
      };
    } catch (err) {
      setWsStatus("error");
      push("sys", err instanceof Error ? err.message : "Failed to connect");
    }
  };

  const disconnect = () => sockets.get(SLOT)?.close();

  const send = () => {
    const ws = sockets.get(SLOT);
    if (ws?.readyState !== WebSocket.OPEN || !message) return;
    ws.send(message);
    push("out", message, new Blob([message]).size);
    const next = [message, ...recent.filter((m) => m !== message)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
    setMessage("");
  };

  const statusColor =
    status === "open"
      ? "var(--kp-success)"
      : status === "connecting"
        ? "var(--kp-warning)"
        : status === "error"
          ? "var(--kp-error)"
          : "var(--kp-text-muted)";

  return (
    <div className="kp-ws-workspace">
      {/* URL bar */}
      <div className="kp-urlbar">
        <span className={`kp-ws-status-dot`} style={{ background: statusColor }} title={status} />
        <input
          type="text"
          value={url}
          onChange={(e) => setWsUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && status !== "open" && connect()}
          placeholder="wss://echo.websocket.org"
          className="kp-url-input kp-mono"
          spellCheck={false}
        />
        <div className="kp-send-group">
          {status === "open" || status === "connecting" ? (
            <button type="button" className="kp-send-btn" onClick={disconnect}>
              <Plug size={14} /> Disconnect
            </button>
          ) : (
            <button type="button" className="kp-send-btn" onClick={connect}>
              <Plug size={14} /> Connect
            </button>
          )}
        </div>
      </div>

      {/* Log */}
      <div className="kp-ws-log kp-scroll" ref={logRef}>
        {log.length === 0 && <p className="kp-hint">Connect and exchange messages — frames appear here.</p>}
        {log.map((m, i) => (
          <div className={clsx("kp-ws-msg", m.dir)} key={i}>
            <span className="kp-ws-time">{m.time}</span>
            <span className="kp-ws-dir">{m.dir === "in" ? "←" : m.dir === "out" ? "→" : "•"}</span>
            <span className="kp-ws-text kp-mono">{m.text}</span>
            {m.size !== undefined && <span className="kp-ws-size">{formatBytes(m.size)}</span>}
          </div>
        ))}
        <button
          type="button"
          className="kp-icon-btn kp-ws-clear"
          title="Clear log"
          onClick={clearWsLog}
        >
          <Eraser size={13} />
        </button>
      </div>

      {/* Composer */}
      <div className="kp-ws-composer">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            else if (e.key === "ArrowUp" && !message && recent.length > 0) {
              e.preventDefault();
              setMessage(recent[0]);
            }
          }}
          placeholder={status === "open" ? "Type a message and press Enter (↑ recalls the last one)" : "Connect first"}
          className="kp-url-input kp-mono"
          disabled={status !== "open"}
          spellCheck={false}
        />
        <button
          type="button"
          className="kp-send-btn"
          onClick={send}
          disabled={status !== "open" || !message}
        >
          <Send size={14} /> Send
        </button>
      </div>

      {/* Recent messages */}
      {recent.length > 0 && (
        <div className="kp-ws-recent">
          {recent.map((m, i) => (
            <button
              key={i}
              type="button"
              className="kp-chip kp-mono"
              title={m}
              onClick={() => setMessage(m)}
              disabled={status !== "open"}
            >
              <ArrowDownToLine size={11} /> {m.length > 60 ? `${m.slice(0, 60)}…` : m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

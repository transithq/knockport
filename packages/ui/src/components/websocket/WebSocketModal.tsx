import { useEffect, useRef, useState } from "react";
import { Plug, X, Send, Loader2 } from "lucide-react";
import { useAppStore } from "../../store/app-store";

interface WsMessage {
  dir: "in" | "out" | "sys";
  text: string;
  time: string;
}

export function WebSocketModal() {
  const open = useAppStore((s) => s.websocketOpen);
  const setOpen = useAppStore((s) => s.setWebsocketOpen);
  const [url, setUrl] = useState("wss://echo.websocket.org");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [log, setLog] = useState<WsMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  if (!open) return null;

  const push = (dir: WsMessage["dir"], text: string) =>
    setLog((l) => [...l, { dir, text, time: new Date().toLocaleTimeString() }]);

  const connect = () => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      push("sys", `Connecting to ${url}...`);
      ws.onopen = () => { setConnected(true); push("sys", "Connected"); };
      ws.onmessage = (e) => push("in", String(e.data));
      ws.onclose = () => { setConnected(false); push("sys", "Disconnected"); };
      ws.onerror = () => push("sys", "Connection error");
    } catch (err) {
      push("sys", err instanceof Error ? err.message : "Failed to connect");
    }
  };

  const disconnect = () => wsRef.current?.close();

  const send = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN && message) {
      wsRef.current.send(message);
      push("out", message);
      setMessage("");
    }
  };

  return (
    <div className="kp-cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="kp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kp-modal-header">
          <span>WebSocket</span>
          <button type="button" className="kp-icon-btn" onClick={() => setOpen(false)}><X size={14} /></button>
        </div>

        <div className="kp-ws-controls">
          <input
            type="text"
            className="kp-url-input kp-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://echo.websocket.org"
            disabled={connected}
          />
          {connected ? (
            <button type="button" className="kp-btn secondary" onClick={disconnect}>Disconnect</button>
          ) : (
            <button type="button" className="kp-btn primary" onClick={connect}><Plug size={14} /> Connect</button>
          )}
        </div>

        <div className="kp-ws-log kp-scroll" ref={logRef}>
          {log.length === 0 && <p className="kp-hint">Messages appear here.</p>}
          {log.map((m, i) => (
            <div className={`kp-ws-msg ${m.dir}`} key={i}>
              <span className="kp-ws-time">{m.time}</span>
              <span className="kp-ws-dir">{m.dir === "in" ? "←" : m.dir === "out" ? "→" : "•"}</span>
              <span className="kp-ws-text kp-mono">{m.text}</span>
            </div>
          ))}
        </div>

        <div className="kp-ws-controls">
          <input
            type="text"
            className="kp-url-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type a message..."
            disabled={!connected}
          />
          <button type="button" className="kp-btn primary" onClick={send} disabled={!connected}><Send size={14} /> Send</button>
        </div>
      </div>
    </div>
  );
}

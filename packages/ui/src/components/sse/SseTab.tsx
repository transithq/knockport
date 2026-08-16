import { Eraser, Play, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "../../store/app-store";
import { parseSseFrame, takeCompleteFrames } from "./sse-parse";

// ── Server-Sent Events workspace tab ─────────────────────────────────────────
// Hoppscotch-style SSE client: fetch + ReadableStream with manual frame parsing
// (EventSource can't set headers, so auth/Last-Event-ID need fetch). Direct
// transport only — the relay is request/response and cannot stream. Reconnect
// is manual (Connect again); Last-Event-ID is sent automatically when set.

const controllers = new Map<string, AbortController>();
const SLOT = "singleton";

export function SseTab() {
  const url = useAppStore((s) => s.sseUrl);
  const setSseUrl = useAppStore((s) => s.setSseUrl);
  const status = useAppStore((s) => s.sseStatus);
  const setSseStatus = useAppStore((s) => s.setSseStatus);
  const log = useAppStore((s) => s.sseLog);
  const pushSseLog = useAppStore((s) => s.pushSseLog);
  const clearSseLog = useAppStore((s) => s.clearSseLog);
  const lastEventId = useAppStore((s) => s.sseLastEventId);
  const setSseLastEventId = useAppStore((s) => s.setSseLastEventId);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Abort any live stream when the app workspace unmounts.
  useEffect(() => {
    return () => {
      controllers.get(SLOT)?.abort();
      controllers.delete(SLOT);
    };
  }, []);

  const pushSys = (data: string) =>
    pushSseLog({ event: "system", data, time: new Date().toLocaleTimeString() });

  const handleFrame = (frame: string) => {
    const parsed = parseSseFrame(frame);
    if (!parsed) return;
    pushSseLog({ ...parsed, time: new Date().toLocaleTimeString() });
    if (parsed.id) setSseLastEventId(parsed.id);
  };

  const connect = async () => {
    if (!/^https?:\/\//i.test(url)) {
      pushSys("URL must start with http:// or https://");
      return;
    }
    controllers.get(SLOT)?.abort();
    const controller = new AbortController();
    controllers.set(SLOT, controller);
    setSseStatus("connecting");
    pushSys(`Connecting to ${url}${lastEventId ? ` (Last-Event-ID: ${lastEventId})` : ""}…`);
    try {
      const res = await fetch(url, {
        headers: {
          accept: "text/event-stream",
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setSseStatus("error");
        pushSys(`HTTP ${res.status} ${res.statusText || ""} — check CORS/endpoint`.trim());
        return;
      }
      setSseStatus("open");
      pushSys("Stream open");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        // A frame ends at a blank line; the trailing chunk may be partial,
        // so only consume COMPLETE frames and keep the remainder buffered.
        const [frames, rest] = takeCompleteFrames(buf);
        buf = rest;
        for (const frame of frames) handleFrame(frame);
      }
      setSseStatus("closed");
      pushSys("Stream ended");
    } catch (err) {
      if (controller.signal.aborted) {
        setSseStatus("closed");
        pushSys("Disconnected");
      } else {
        setSseStatus("error");
        pushSys(err instanceof Error ? err.message : "Connection failed (CORS?)");
      }
    } finally {
      controllers.delete(SLOT);
    }
  };

  const stop = () => controllers.get(SLOT)?.abort();

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
        <span className="kp-ws-status-dot" style={{ background: statusColor }} title={status} />
        <input
          type="text"
          value={url}
          onChange={(e) => setSseUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && status !== "open" && void connect()}
          placeholder="https://example.com/stream"
          className="kp-url-input kp-mono"
          spellCheck={false}
        />
        <div className="kp-send-group">
          {status === "open" || status === "connecting" ? (
            <button type="button" className="kp-send-btn" onClick={stop}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button type="button" className="kp-send-btn" onClick={() => void connect()}>
              <Play size={12} /> Connect
            </button>
          )}
        </div>
      </div>

      {/* Event log */}
      <div className="kp-ws-log kp-scroll" ref={logRef}>
        {log.length === 0 && (
          <p className="kp-hint">Connect to an event stream — events appear here.</p>
        )}
        {log.map((e, i) => (
          <div className={e.event === "system" ? "kp-ws-msg sys" : "kp-ws-msg in"} key={i}>
            <span className="kp-ws-time">{e.time}</span>
            <span className="kp-sse-event">{e.event}</span>
            {e.id !== undefined && <span className="kp-sse-id kp-mono">id: {e.id}</span>}
            <span className="kp-ws-text kp-mono">{e.data}</span>
          </div>
        ))}
        <button type="button" className="kp-icon-btn kp-ws-clear" title="Clear log" onClick={clearSseLog}>
          <Eraser size={13} />
        </button>
      </div>
    </div>
  );
}

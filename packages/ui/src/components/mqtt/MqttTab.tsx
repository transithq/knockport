import mqtt, { type MqttClient } from "mqtt";
import { Cloud, Eraser, Plus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";

// ── MQTT workspace tab ───────────────────────────────────────────────────────
// Hoppscotch-style MQTT client over mqtt.js (WebSocket transport — brokers
// must expose ws:// or wss:// listeners, e.g. test.mosquitto.org:8081 or
// broker.emqx.io:8084/mqtt). State lives in the store so the log survives
// tab switches; the client instance is module-level.

const clients = new Map<string, MqttClient>();
const SLOT = "singleton";

export function MqttTab() {
  const url = useAppStore((s) => s.mqttUrl);
  const setMqttUrl = useAppStore((s) => s.setMqttUrl);
  const status = useAppStore((s) => s.mqttStatus);
  const setMqttStatus = useAppStore((s) => s.setMqttStatus);
  const log = useAppStore((s) => s.mqttLog);
  const pushMqttLog = useAppStore((s) => s.pushMqttLog);
  const clearMqttLog = useAppStore((s) => s.clearMqttLog);
  const topics = useAppStore((s) => s.mqttTopics);
  const addMqttTopic = useAppStore((s) => s.addMqttTopic);
  const removeMqttTopic = useAppStore((s) => s.removeMqttTopic);

  const [subInput, setSubInput] = useState("");
  const [pubTopic, setPubTopic] = useState("");
  const [pubMessage, setPubMessage] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Disconnect when the workspace unmounts.
  useEffect(() => {
    return () => {
      clients.get(SLOT)?.end(true);
      clients.delete(SLOT);
    };
  }, []);

  const pushSys = (text: string) =>
    pushMqttLog({ dir: "sys", topic: "", text, time: new Date().toLocaleTimeString() });

  const connected = status === "connected";

  const connect = () => {
    if (!/^wss?:\/\//i.test(url)) {
      pushSys("Broker URL must start with ws:// or wss:// (MQTT over WebSocket)");
      return;
    }
    clients.get(SLOT)?.end(true);
    setMqttStatus("connecting");
    pushSys(`Connecting to ${url}…`);
    try {
      const client = mqtt.connect(url, {
        clientId: `knockport_${Math.random().toString(16).slice(2, 10)}`,
        reconnectPeriod: 0, // manual reconnect — avoid surprise traffic
        connectTimeout: 10_000,
      });
      clients.set(SLOT, client);
      client.on("connect", () => {
        setMqttStatus("connected");
        pushSys("Connected");
        // (Re)subscribe to the saved topic list.
        for (const t of topics) client.subscribe(t);
      });
      client.on("message", (topic, payload) => {
        pushMqttLog({
          dir: "in",
          topic,
          text: payload.toString(),
          time: new Date().toLocaleTimeString(),
        });
      });
      client.on("error", (err) => {
        setMqttStatus("error");
        pushSys(err.message || "Connection error");
      });
      client.on("close", () => {
        if (useAppStore.getState().mqttStatus === "connected") {
          setMqttStatus("idle");
          pushSys("Disconnected");
        }
      });
    } catch (err) {
      setMqttStatus("error");
      pushSys(err instanceof Error ? err.message : "Failed to connect");
    }
  };

  const disconnect = () => {
    clients.get(SLOT)?.end(true);
    clients.delete(SLOT);
    setMqttStatus("idle");
    pushSys("Disconnected");
  };

  const subscribe = () => {
    const topic = subInput.trim();
    if (!topic) return;
    addMqttTopic(topic);
    clients.get(SLOT)?.subscribe(topic);
    pushSys(`Subscribed to ${topic}`);
    setSubInput("");
  };

  const unsubscribe = (topic: string) => {
    clients.get(SLOT)?.unsubscribe(topic);
    removeMqttTopic(topic);
    pushSys(`Unsubscribed from ${topic}`);
  };

  const publish = () => {
    const client = clients.get(SLOT);
    if (client?.connected && pubTopic && pubMessage) {
      client.publish(pubTopic.trim(), pubMessage);
      pushMqttLog({
        dir: "out",
        topic: pubTopic.trim(),
        text: pubMessage,
        time: new Date().toLocaleTimeString(),
      });
      setPubMessage("");
    }
  };

  const statusColor =
    status === "connected"
      ? "var(--kp-success)"
      : status === "connecting" || status === "reconnecting"
        ? "var(--kp-warning)"
        : status === "error"
          ? "var(--kp-error)"
          : "var(--kp-text-muted)";

  return (
    <div className="kp-ws-workspace">
      {/* Broker bar */}
      <div className="kp-urlbar">
        <span className="kp-ws-status-dot" style={{ background: statusColor }} title={status} />
        <input
          type="text"
          value={url}
          onChange={(e) => setMqttUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !connected && connect()}
          placeholder="wss://test.mosquitto.org:8081/mqtt"
          className="kp-url-input kp-mono"
          spellCheck={false}
        />
        <div className="kp-send-group">
          {connected || status === "connecting" ? (
            <button type="button" className="kp-send-btn" onClick={disconnect}>
              <Cloud size={13} /> Disconnect
            </button>
          ) : (
            <button type="button" className="kp-send-btn" onClick={connect}>
              <Cloud size={13} /> Connect
            </button>
          )}
        </div>
      </div>

      {/* Subscribe + publish */}
      <div className="kp-mqtt-subscribe">
        <input
          type="text"
          value={subInput}
          onChange={(e) => setSubInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && subscribe()}
          placeholder="Topic to subscribe (e.g. knockport/demo/#)"
          className="kp-url-input kp-mono"
          disabled={!connected}
          spellCheck={false}
        />
        <button type="button" className="kp-btn primary" onClick={subscribe} disabled={!connected}>
          <Plus size={13} /> Subscribe
        </button>
      </div>
      {topics.length > 0 && (
        <div className="kp-mqtt-topics">
          {topics.map((t) => (
            <span className="kp-chip kp-mono" key={t}>
              {t}
              <button
                type="button"
                className="kp-file-clear"
                title="Unsubscribe"
                onClick={() => unsubscribe(t)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="kp-ws-composer">
        <input
          type="text"
          value={pubTopic}
          onChange={(e) => setPubTopic(e.target.value)}
          placeholder="Publish topic"
          className="kp-url-input kp-mono"
          style={{ maxWidth: 220 }}
          disabled={!connected}
          spellCheck={false}
        />
        <input
          type="text"
          value={pubMessage}
          onChange={(e) => setPubMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && publish()}
          placeholder="Message payload"
          className="kp-url-input kp-mono"
          disabled={!connected}
          spellCheck={false}
        />
        <button
          type="button"
          className="kp-send-btn"
          onClick={publish}
          disabled={!connected || !pubTopic || !pubMessage}
        >
          <Send size={14} /> Publish
        </button>
      </div>

      {/* Message log */}
      <div className="kp-ws-log kp-scroll" ref={logRef}>
        {log.length === 0 && <p className="kp-hint">Connect to a broker — messages appear here.</p>}
        {log.map((m, i) => (
          <div className={`kp-ws-msg ${m.dir}`} key={i}>
            <span className="kp-ws-time">{m.time}</span>
            <span className="kp-ws-dir">{m.dir === "in" ? "←" : m.dir === "out" ? "→" : "•"}</span>
            {m.topic && <span className="kp-sse-event kp-mono">{m.topic}</span>}
            <span className="kp-ws-text kp-mono">{m.text}</span>
          </div>
        ))}
        <button
          type="button"
          className="kp-icon-btn kp-ws-clear"
          title="Clear log"
          onClick={clearMqttLog}
        >
          <Eraser size={13} />
        </button>
      </div>
    </div>
  );
}

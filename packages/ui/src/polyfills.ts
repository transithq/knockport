import { Buffer } from "buffer";

// ── Browser polyfills for Node globals ───────────────────────────────────────
// mqtt.js v4 (MQTT workspace) references `process` and `Buffer` at module
// evaluation; both are undefined in browsers and would throw during app boot.
// Imported FIRST in apps/web/src/main.tsx so every later import is safe.
// `Buffer` is the real implementation from the `buffer` package; `process`
// only needs the surface mqtt touches (nextTick/env/version/stream stubs).

const g = globalThis as Record<string, unknown>;

if (typeof g.process === "undefined") {
  g.process = {
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
      queueMicrotask(() => fn(...args)),
    env: {},
    version: "",
    title: "browser",
    stdout: { write: () => true },
    stderr: { write: () => true },
  };
}

if (typeof g.Buffer === "undefined") {
  g.Buffer = Buffer;
}

if (typeof g.global === "undefined") {
  g.global = globalThis;
}

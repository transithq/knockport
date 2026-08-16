// ── SSE frame parsing (pure) ─────────────────────────────────────────────────
// One frame = lines separated by \n, terminated by a blank line. Fields:
// event / data (repeatable, joined with \n) / id; `:`-prefixed lines are
// comments; `retry:` is accepted but ignored (reconnection is manual here).

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export function parseSseFrame(frame: string): SseFrame | null {
  let event = "";
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
    else if (field === "id" && value) id = value;
  }
  if (dataLines.length === 0 && !event) return null;
  return { event: event || "message", data: dataLines.join("\n"), id };
}

/** Split a stream buffer into complete frames; returns [frames, remainder]. */
export function takeCompleteFrames(buf: string): [string[], string] {
  const frames: string[] = [];
  let rest = buf;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx === -1) break;
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    if (frame.trim()) frames.push(frame);
  }
  return [frames, rest];
}

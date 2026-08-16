import type { KeyValuePair } from "@knockport/core";

// ── URL ↔ query-params sync (Postman/Bruno semantics) ───────────────────────
// The stored model keeps the bare URL (path only) plus the params table; the
// URL BAR renders both merged, and editing the bar re-parses the query back
// into the table. Transports append enabled params at send time (buildUrl),
// so the stored URL must stay query-free to avoid double-appending.

/** Split a URL at the first `?` into [path, query] (query null when absent). */
export function splitQuery(url: string): [string, string | null] {
  const i = url.indexOf("?");
  if (i === -1) return [url, null];
  return [url.slice(0, i), url.slice(i + 1)];
}

/** Render the URL bar value: path + query baked into the URL + enabled
 * params, joined with `&`. Values are percent-encoded for the URL, except
 * `{{placeholders}}` which stay readable (they resolve before send). */
export function displayUrl(url: string, params: KeyValuePair[]): string {
  const [path, existing] = splitQuery(url);
  const enc = (s: string) =>
    encodeURIComponent(s).replace(/%7B%7B/g, "{{").replace(/%7D%7D/g, "}}");
  const fromParams = params
    .filter((p) => p.enabled && p.key)
    .map((p) => `${enc(p.key)}=${enc(p.value)}`)
    .join("&");
  const qs = [existing, fromParams].filter(Boolean).join("&");
  return qs ? `${path}?${qs}` : path;
}

/** Parse a raw query string (`a=1&b=two%20words`) into enabled param pairs.
 * Keys without a value become `key: ""`; empty keys are dropped. */
export function parseQuery(query: string): KeyValuePair[] {
  if (!query) return [];
  const sp = new URLSearchParams(query);
  const out: KeyValuePair[] = [];
  for (const [key, value] of sp.entries()) {
    if (key) out.push({ key, value, enabled: true });
  }
  return out;
}

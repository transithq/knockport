// ── Minimal Node `url` shim for mqtt.js in the browser ───────────────────────
// mqtt v4 calls url.parse() on broker URLs (wss://host:port/path) and reads
// the legacy UrlObject fields. Aliased as the `url` module in apps/web's
// vite config. Only the surface mqtt touches is implemented.

export interface ParsedUrl {
  protocol: string;
  slashes: boolean;
  host: string | null;
  port: string;
  hostname: string;
  path: string | null;
  pathname: string | null;
  search: string | null;
  query: string | null;
  auth: string | null;
  hash: string | null;
  href: string;
}

const DEFAULT_PORTS: Record<string, string> = {
  "ws:": "80",
  "wss:": "443",
  "http:": "80",
  "https:": "443",
  "mqtts:": "8883",
  "mqtt:": "1883",
};

export function parse(input: string): ParsedUrl {
  const u = new URL(input);
  const protocol = u.protocol; // includes trailing ':', like Node
  const auth = u.username
    ? `${decodeURIComponent(u.username)}${u.password ? ":" + decodeURIComponent(u.password) : ""}`
    : null;
  const port = u.port || DEFAULT_PORTS[protocol] || "";
  const host = u.hostname + (port ? ":" + port : "");
  return {
    protocol,
    slashes: true,
    host,
    port,
    hostname: u.hostname,
    path: u.pathname + u.search || null,
    pathname: u.pathname || null,
    search: u.search || null,
    query: u.search ? u.search.slice(1) : null,
    auth,
    hash: u.hash || null,
    href: u.href,
  };
}

export function format(url: ParsedUrl | string): string {
  if (typeof url === "string") return url;
  return url.href;
}

export function resolve(from: string, to: string): string {
  return new URL(to, from).href;
}

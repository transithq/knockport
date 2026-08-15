import type { Request, Response, ResponseTimings } from "@knockport/core";

// ── Transport Interface ──────────────────────────────────────────────────────
/**
 * The single interface every transport implements.
 * Direct (browser fetch), relay, extension SW, Tauri native — all conform to this.
 */
export interface Transport {
  readonly id: TransportId;
  readonly name: string;

  /** Whether this transport is currently available. */
  isAvailable(): boolean;

  /** Execute a single HTTP request and return the full response. */
  execute(request: Request, options?: TransportOptions): Promise<Response>;

  /** Cancel an in-flight request by its ID. */
  cancel(requestId: string): void;
}

export type TransportId = "direct" | "relay" | "extension" | "tauri";

export interface TransportOptions {
  signal?: AbortSignal;
  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  verifySSL?: boolean;
}

// ── Transport Registry ───────────────────────────────────────────────────────
export class TransportRegistry {
  private transports = new Map<TransportId, Transport>();
  private preferred: TransportId[] = ["tauri", "extension", "relay", "direct"];

  register(transport: Transport): void {
    this.transports.set(transport.id, transport);
  }

  unregister(id: TransportId): void {
    this.transports.delete(id);
  }

  /**
   * Get the best available transport based on preference order.
   */
  getBest(): Transport | undefined {
    for (const id of this.preferred) {
      const transport = this.transports.get(id);
      if (transport?.isAvailable()) return transport;
    }
    return undefined;
  }

  get(id: TransportId): Transport | undefined {
    return this.transports.get(id);
  }

  getAll(): Transport[] {
    return Array.from(this.transports.values());
  }

  setPreference(order: TransportId[]): void {
    this.preferred = order;
  }
}

// ── Shared request-building helpers ─────────────────────────────────────────
function buildUrl(request: Request): string {
  const url = new URL(request.url);
  for (const param of request.params) {
    if (param.enabled && param.key) {
      url.searchParams.append(param.key, param.value);
    }
  }
  return url.toString();
}

function buildHeaderList(request: Request): { key: string; value: string }[] {
  const headers: { key: string; value: string }[] = [];
  for (const header of request.headers) {
    if (header.enabled && header.key) {
      headers.push({ key: header.key, value: header.value });
    }
  }
  return headers;
}

function buildBody(request: Request): BodyInit | undefined {
  if (!request.body || request.body.type === "none") return undefined;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return undefined;

  switch (request.body.type) {
    case "json":
    case "text":
    case "xml":
    case "html":
    case "graphql":
      return request.body.content;
    case "form-urlencoded": {
      const params = new URLSearchParams();
      for (const entry of request.body.formData ?? []) {
        if (entry.enabled && entry.type === "text") {
          params.append(entry.key, entry.value as string);
        }
      }
      return params.toString();
    }
    case "multipart-form": {
      const formData = new FormData();
      for (const entry of request.body.formData ?? []) {
        if (entry.enabled) {
          formData.append(entry.key, entry.value);
        }
      }
      return formData;
    }
    case "binary":
      return request.body.content;
    default:
      return undefined;
  }
}

function parseCookies(headers: Headers): import("@knockport/core").ResponseCookie[] {
  const cookies: import("@knockport/core").ResponseCookie[] = [];
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return cookies;

  const parts = setCookie.split(",").map((s) => s.trim());
  for (const part of parts) {
    const [nameValue, ...attrs] = part.split(";").map((s) => s.trim());
    const eqIdx = nameValue.indexOf("=");
    if (eqIdx === -1) continue;

    const cookie: import("@knockport/core").ResponseCookie = {
      name: nameValue.slice(0, eqIdx),
      value: nameValue.slice(eqIdx + 1),
    };

    for (const attr of attrs) {
      const [key, val] = attr.split("=").map((s) => s.trim());
      const lk = key.toLowerCase();
      if (lk === "domain") cookie.domain = val;
      else if (lk === "path") cookie.path = val;
      else if (lk === "expires") cookie.expires = val;
      else if (lk === "httponly") cookie.httpOnly = true;
      else if (lk === "secure") cookie.secure = true;
      else if (lk === "samesite")
        cookie.sameSite = val as "Strict" | "Lax" | "None";
    }
    cookies.push(cookie);
  }
  return cookies;
}

function parseCookieString(setCookie: string | undefined): import("@knockport/core").ResponseCookie[] {
  const headers = new Headers();
  if (setCookie) headers.set("set-cookie", setCookie);
  return parseCookies(headers);
}

// ── Relay Transport (apps/relay Rust service) ────────────────────────────────
/**
 * Forwards requests through the KnockPort relay service (apps/relay), which
 * executes them server-side so browser CORS never blocks the web tier.
 * Wire format: POST {relayUrl}/proxy → JSON ProxyResponse.
 */
export class RelayTransport implements Transport {
  readonly id = "relay" as const;
  readonly name = "Relay (Server-Side)";

  private activeRequests = new Map<string, AbortController>();
  private healthy: boolean | null = null;

  constructor(private relayUrl: string = "http://localhost:8787") {}

  /** Synchronous availability = last known health (call checkHealth() to probe). */
  isAvailable(): boolean {
    return this.healthy !== false;
  }

  /** Probe GET /health and cache the result. */
  async checkHealth(timeoutMs = 1500): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${this.relayUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      this.healthy = res.ok;
    } catch {
      this.healthy = false;
    }
    return this.healthy === true;
  }

  async execute(request: Request, options?: TransportOptions): Promise<Response> {
    const controller = new AbortController();
    this.activeRequests.set(request.id, controller);
    const signal = options?.signal
      ? this.linkSignals(options.signal, controller)
      : controller.signal;

    const url = buildUrl(request);
    const headers = buildHeaderList(request);
    const bodyInit = buildBody(request);
    if (bodyInit instanceof FormData) {
      this.activeRequests.delete(request.id);
      throw new Error("Multipart bodies are not yet supported via the relay — use Direct transport.");
    }
    const body =
      typeof bodyInit === "string" ? bodyInit : bodyInit != null ? String(bodyInit) : undefined;

    const startTime = performance.now();
    try {
      const fetchResponse = await fetch(`${this.relayUrl}/proxy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: request.method, url, headers, body }),
        signal,
      });

      if (!fetchResponse.ok) {
        const detail = await fetchResponse.json().catch(() => ({ error: fetchResponse.statusText }));
        throw new Error(`Relay error: ${detail.error ?? fetchResponse.status}`);
      }

      this.healthy = true;
      const relay: RelayProxyResponse = await fetchResponse.json();
      const endTime = performance.now();

      const responseHeaders: Record<string, string> = {};
      for (const h of relay.headers) responseHeaders[h.key.toLowerCase()] = h.value;

      const decodedBody =
        relay.encoding === "base64" ? decodeBase64ToBinaryText(relay.body) : relay.body;

      const timings: ResponseTimings = {
        total: relay.timings?.total ?? endTime - startTime,
        ttfb: relay.timings?.ttfb ?? relay.timings?.total ?? endTime - startTime,
        download: Math.max(0, (relay.timings?.total ?? 0) - (relay.timings?.ttfb ?? 0)),
      };

      return {
        id: crypto.randomUUID(),
        requestId: request.id,
        status: relay.status,
        statusText: relay.statusText,
        headers: responseHeaders,
        body: decodedBody,
        bodySize: new TextEncoder().encode(decodedBody).length,
        contentType: responseHeaders["content-type"],
        timings,
        cookies: parseCookieString(responseHeaders["set-cookie"]),
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  cancel(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }

  private linkSignals(external: AbortSignal, controller: AbortController): AbortSignal {
    external.addEventListener("abort", () => controller.abort(), { once: true });
    return controller.signal;
  }
}

interface RelayProxyResponse {
  status: number;
  statusText: string;
  headers: { key: string; value: string }[];
  body: string;
  encoding: "utf8" | "base64";
  timings?: { total: number; ttfb: number };
}

/** Decode base64 to a latin-1 string so binary payloads survive the text pipeline. */
function decodeBase64ToBinaryText(b64: string): string {
  const binary = atob(b64);
  let out = "";
  for (let i = 0; i < binary.length; i++) out += String.fromCharCode(binary.charCodeAt(i));
  return out;
}

// ── Transport selection ──────────────────────────────────────────────────────
/**
 * Pick the transport for the current surface. Web defaults to relay when a
 * relay URL is configured; direct fetch stays available as a fallback toggle.
 */
export function getTransport(opts: { useRelay: boolean; relayUrl?: string }): Transport {
  if (opts.useRelay && opts.relayUrl) {
    return new RelayTransport(opts.relayUrl);
  }
  return new DirectTransport();
}

// ── Direct Transport (browser fetch) ─────────────────────────────────────────
/**
 * Direct browser fetch transport.
 * Limitation: CORS will block cross-origin requests to most APIs.
 * This is primarily useful for development and CORS-permissive targets.
 */
export class DirectTransport implements Transport {
  readonly id = "direct" as const;
  readonly name = "Direct (Browser Fetch)";

  private activeRequests = new Map<string, AbortController>();

  isAvailable(): boolean {
    return typeof fetch !== "undefined";
  }

  async execute(request: Request, options?: TransportOptions): Promise<Response> {
    const controller = new AbortController();
    this.activeRequests.set(request.id, controller);

    const signal = options?.signal
      ? this.linkSignals(options.signal, controller)
      : controller.signal;

    const url = buildUrl(request);
    const headers = Object.fromEntries(buildHeaderList(request).map((h) => [h.key, h.value]));
    const body = buildBody(request);

    const startTime = performance.now();
    const ttfbStart = startTime;

    try {
      const fetchResponse = await fetch(url, {
        method: request.method,
        headers,
        body,
        signal,
        redirect: options?.followRedirects === false ? "manual" : "follow",
      });

      const ttfbEnd = performance.now();
      const responseBody = await fetchResponse.text();
      const endTime = performance.now();

      const responseHeaders: Record<string, string> = {};
      fetchResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const timings: ResponseTimings = {
        total: endTime - startTime,
        ttfb: ttfbEnd - ttfbStart,
        download: endTime - ttfbEnd,
      };

      const contentType = fetchResponse.headers.get("content-type") ?? undefined;

      return {
        id: crypto.randomUUID(),
        requestId: request.id,
        status: fetchResponse.status,
        statusText: fetchResponse.statusText,
        headers: responseHeaders,
        body: responseBody,
        bodySize: new TextEncoder().encode(responseBody).length,
        contentType,
        timings,
        cookies: parseCookies(fetchResponse.headers),
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  cancel(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }

  private linkSignals(external: AbortSignal, controller: AbortController): AbortSignal {
    external.addEventListener("abort", () => controller.abort(), { once: true });
    return controller.signal;
  }
}

export { DirectTransport as default };

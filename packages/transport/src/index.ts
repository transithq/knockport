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

    const url = this.buildUrl(request);
    const headers = this.buildHeaders(request);
    const body = this.buildBody(request);

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
        cookies: this.parseCookies(fetchResponse.headers),
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

  private buildUrl(request: Request): string {
    const url = new URL(request.url);
    for (const param of request.params) {
      if (param.enabled && param.key) {
        url.searchParams.append(param.key, param.value);
      }
    }
    return url.toString();
  }

  private buildHeaders(request: Request): HeadersInit {
    const headers: Record<string, string> = {};
    for (const header of request.headers) {
      if (header.enabled && header.key) {
        headers[header.key] = header.value;
      }
    }
    return headers;
  }

  private buildBody(request: Request): BodyInit | undefined {
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

  private parseCookies(headers: Headers): import("@knockport/core").ResponseCookie[] {
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

  private linkSignals(external: AbortSignal, controller: AbortController): AbortSignal {
    external.addEventListener("abort", () => controller.abort(), { once: true });
    return controller.signal;
  }
}

export { DirectTransport as default };

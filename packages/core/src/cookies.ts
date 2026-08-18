import type { ResponseCookie } from "./types.js";

// ── Persistent cookie jar (G1) ───────────────────────────────────────────────
// A RFC-6265-flavoured cookie store keyed per domain: responses' Set-Cookie
// headers are captured per request URL, and matching cookies are re-attached
// as a `Cookie` header on subsequent sends. The matching rules are the
// client-side subset of RFC 6265 §5.1.4 (domain match, path match, secure,
// expiry); the transport already parses raw Set-Cookie values into
// `ResponseCookie` objects (tropel-http exposes them on the relay wire), so
// this module owns the *store* semantics only — no header parsing is
// duplicated here.

export interface StoredCookie {
  /** Cookie name. */
  key: string;
  value: string;
  /**
   * Effective domain scope (lowercased, leading dot stripped). Host-only
   * cookies store the exact request host here.
   */
  domain: string;
  /** True when the Set-Cookie had no Domain attribute (exact-host match only). */
  hostOnly: boolean;
  /** Path scope (default "/"). */
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  /** Absolute ms epoch; undefined = session cookie (never expires on its own). */
  expires?: number;
  /** ms epoch when stored. */
  created: number;
  /** ms epoch of the last read. */
  lastAccessed: number;
}

/** Plain serializable form (persistence across sessions). */
export type SerializedCookie = Omit<StoredCookie, "expires"> & { expires?: number };

/** The unique identity of a cookie within the jar: domain + path + name. */
export function cookieIdentity(c: Pick<StoredCookie, "key" | "domain" | "path">): string {
  return `${c.domain}|${c.path}|${c.key}`;
}

/** Strip a leading dot and lowercase a cookie domain. */
export function normalizeCookieDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

/**
 * RFC 6265 §5.1.3 domain-match: `host` matches `domain` when it is the same
 * host or a subdomain of it (host-only cookies are matched exactly by the
 * caller).
 */
export function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = normalizeCookieDomain(domain);
  if (h === d) return true;
  if (h.endsWith(`.${d}`)) return true;
  // The cookie's own host-only flag is handled by the caller; a bare host
  // value here still matches exactly.
  return false;
}

/**
 * RFC 6265 §5.1.4 path-match: `reqPath` matches `cookiePath` when it is
 * identical, the cookie path is "/", or reqPath starts with cookiePath
 * followed by a "/".
 */
export function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (cookiePath === "/") return true;
  if (reqPath === cookiePath) return true;
  if (reqPath.startsWith(cookiePath)) {
    return reqPath.charAt(cookiePath.length) === "/";
  }
  return false;
}

/** The effective domain a Set-Cookie applies to (RFC 6265 §5.3 item 6/7). */
function effectiveCookieDomain(url: URL, cookie: ResponseCookie): { domain: string; hostOnly: boolean } {
  const attr = cookie.domain;
  if (attr) {
    const d = normalizeCookieDomain(attr);
    // Reject a Domain attribute that doesn't domain-match the request host.
    if (!domainMatches(url.hostname, d)) return { domain: url.hostname, hostOnly: true };
    return { domain: d, hostOnly: false };
  }
  return { domain: url.hostname.toLowerCase(), hostOnly: true };
}

/** Effective expiry (ms epoch): max-age wins over expires; undefined = session. */
function effectiveExpiry(cookie: ResponseCookie, now: number): number | undefined {
  if (cookie.maxAge !== undefined) {
    if (Number.isFinite(cookie.maxAge)) return now + cookie.maxAge * 1000;
    return undefined;
  }
  if (cookie.expires) {
    const t = Date.parse(cookie.expires);
    if (!Number.isNaN(t)) return t;
  }
  return undefined;
}

export class CookieJar {
  private cookies = new Map<string, StoredCookie>();

  constructor(initial?: Iterable<StoredCookie>) {
    if (initial) {
      for (const c of initial) this.cookies.set(cookieIdentity(c), { ...c });
    }
  }

  /** All stored cookies (G2 manager browse). */
  all(): StoredCookie[] {
    return [...this.cookies.values()];
  }

  /** Number of stored cookies (before expiry pruning). */
  count(): number {
    return this.cookies.size;
  }

  /** True when no cookies are stored. */
  isEmpty(): boolean {
    return this.cookies.size === 0;
  }

  /**
   * Capture a response's Set-Cookie headers into the jar (G1). Deletions are
   * honored: a cookie with max-age <= 0 or an expired expires removes the
   * stored entry with the same identity.
   */
  setFromResponse(url: string, setCookies: ResponseCookie[], now: number = Date.now()): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    for (const raw of setCookies) {
      if (!raw.name) continue;
      const { domain, hostOnly } = effectiveCookieDomain(parsed, raw);
      const path = raw.path || "/";
      const expires = effectiveExpiry(raw, now);
      // max-age <= 0 (or an already-passed expires) means "delete".
      if (expires !== undefined && expires <= now) {
        this.cookies.delete(cookieIdentity({ key: raw.name, domain, path }));
        continue;
      }
      const id = cookieIdentity({ key: raw.name, domain, path });
      const existing = this.cookies.get(id);
      this.cookies.set(id, {
        key: raw.name,
        value: raw.value,
        domain,
        hostOnly,
        path,
        secure: raw.secure ?? false,
        httpOnly: raw.httpOnly ?? false,
        sameSite: raw.sameSite,
        expires,
        created: existing?.created ?? now,
        lastAccessed: now,
      });
    }
  }

  /**
   * Cookies that match `url` and are not expired, ordered by path length
   * (longest first) then creation time (RFC 6265 §5.4 "cookie-string" order).
   */
  cookiesFor(url: string, now: number = Date.now()): StoredCookie[] {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return [];
    }
    const host = parsed.hostname.toLowerCase();
    const isSecure = parsed.protocol === "https:";
    const path = parsed.pathname || "/";
    const matches: StoredCookie[] = [];
    for (const c of this.cookies.values()) {
      if (c.expires !== undefined && c.expires <= now) continue;
      if (c.secure && !isSecure) continue;
      if (c.hostOnly) {
        if (host !== c.domain) continue;
      } else if (!domainMatches(host, c.domain)) {
        continue;
      }
      if (!pathMatches(path, c.path)) continue;
      matches.push(c);
    }
    matches.sort(
      (a, b) => b.path.length - a.path.length || (a.created ?? 0) - (b.created ?? 0),
    );
    for (const m of matches) {
      this.cookies.set(cookieIdentity(m), { ...m, lastAccessed: now });
    }
    return matches;
  }

  /** `key=value; key=value` string for a URL, or undefined when nothing matches. */
  cookieHeaderFor(url: string, now?: number): string | undefined {
    const matches = this.cookiesFor(url, now);
    if (matches.length === 0) return undefined;
    return matches.map((c) => `${c.key}=${c.value}`).join("; ");
  }

  /** Set or replace a cookie manually (G2 edit / C8 script `upsert`). */
  upsert(url: string, c: { key: string; value: string; path?: string; secure?: boolean; httpOnly?: boolean; sameSite?: "Strict" | "Lax" | "None"; expires?: number }, now: number = Date.now()): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    const domain = parsed.hostname.toLowerCase();
    const path = c.path || "/";
    const id = cookieIdentity({ key: c.key, domain, path });
    const existing = this.cookies.get(id);
    this.cookies.set(id, {
      key: c.key,
      value: c.value,
      domain,
      hostOnly: true,
      path,
      secure: c.secure ?? false,
      httpOnly: c.httpOnly ?? false,
      sameSite: c.sameSite,
      expires: c.expires,
      created: existing?.created ?? now,
      lastAccessed: now,
    });
  }

  /** Delete the exact cookie identified by (domain, path, key) — G2 edit. */
  deleteCookie(domain: string, path: string, key: string): boolean {
    const id = cookieIdentity({ key, domain: normalizeCookieDomain(domain), path });
    return this.cookies.delete(id);
  }

  /** Delete every stored cookie matching a URL's domain + path scope (C8 `clear`). */
  deleteCookiesForUrl(url: string): number {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 0;
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "/";
    const victims: string[] = [];
    for (const c of this.cookies.values()) {
      if (c.hostOnly ? c.domain === host : domainMatches(host, c.domain)) {
        if (pathMatches(path, c.path)) victims.push(cookieIdentity(c));
      }
    }
    for (const id of victims) this.cookies.delete(id);
    return victims.length;
  }

  /** Delete all cookies scoped to a domain (G2 per-domain clear). */
  deleteDomain(domain: string): number {
    const d = normalizeCookieDomain(domain);
    const victims: string[] = [];
    for (const c of this.cookies.values()) {
      if (c.domain === d) victims.push(cookieIdentity(c));
    }
    for (const id of victims) this.cookies.delete(id);
    return victims.length;
  }

  /** Wipe the whole jar (G2 clear-all). */
  clear(): void {
    this.cookies.clear();
  }

  /** Serializable snapshot (persistence). */
  toJSON(): SerializedCookie[] {
    return this.all().map((c) => ({ ...c }));
  }

  /** Serialized snapshot for localStorage. */
  serialize(): string {
    return JSON.stringify(this.toJSON());
  }
}

/** Hydrate a jar from its serialized form (empty for invalid input). */
export function deserializeCookieJar(raw: string | null | undefined): CookieJar {
  if (!raw) return new CookieJar();
  try {
    const data = JSON.parse(raw) as SerializedCookie[];
    if (!Array.isArray(data)) return new CookieJar();
    return new CookieJar(
      data.filter(
        (c) => c && typeof c.key === "string" && typeof c.domain === "string" && typeof c.path === "string",
      ),
    );
  } catch {
    return new CookieJar();
  }
}
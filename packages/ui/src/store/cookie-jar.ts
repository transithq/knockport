import {
  CookieJar,
  deserializeCookieJar,
  type Response,
} from "@knockport/core";
import type { Request, StoredCookie } from "@knockport/core";

// ── Persistent cookie jar (G1) ───────────────────────────────────────────────
// The jar lives in the zustand store (reactive for the G2 manager tab) and is
// persisted to localStorage. Capture happens on every completed send; the
// auto-attach happens in handleSend / RunnerTab right before execute.

const PERSIST_KEY = "kp-cookie-jar";

/** Rehydrate the jar from localStorage (empty jar when absent/invalid). */
export function loadCookieJar(): CookieJar {
  if (typeof localStorage === "undefined") return new CookieJar();
  return deserializeCookieJar(localStorage.getItem(PERSIST_KEY));
}

/** Persist the jar to localStorage. */
export function persistCookieJar(jar: CookieJar): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERSIST_KEY, jar.serialize());
  } catch {
    // Quota exceeded / storage blocked — the in-memory jar still works.
  }
}

/**
 * Capture a completed response's Set-Cookie headers into the jar and persist.
 * Expired cookies are dropped by the jar itself.
 */
export function captureResponseCookies(jar: CookieJar, response: Response): void {
  if (!response.url) return;
  jar.setFromResponse(response.url, response.cookies);
  persistCookieJar(jar);
}

/**
 * Attach the jar's matching cookies as a `Cookie` header on a resolved
 * request, unless the request already sets one explicitly (explicit wins).
 * Returns a copy; the original request is untouched.
 */
export function attachCookieJar(request: Request, jar: CookieJar): Request {
  const existing = request.headers.some((h) => h.key.toLowerCase() === "cookie" && h.enabled);
  if (existing) return request;
  const value = jar.cookieHeaderFor(request.url);
  if (!value) return request;
  return {
    ...request,
    headers: [...request.headers, { key: "Cookie", value, enabled: true }],
  };
}

export type { StoredCookie };
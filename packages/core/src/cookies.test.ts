import { describe, expect, it } from "vitest";
import {
  CookieJar,
  deserializeCookieJar,
  domainMatches,
  normalizeCookieDomain,
  pathMatches,
} from "./cookies.js";
import type { ResponseCookie } from "./types.js";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function setCookie(name: string, value: string, extra: Partial<ResponseCookie> = {}): ResponseCookie {
  return { name, value, ...extra };
}

describe("cookie domain/path matching", () => {
  it("normalizes leading dots and case", () => {
    expect(normalizeCookieDomain(".Example.COM")).toBe("example.com");
  });

  it("domain-matches host and subdomains but not siblings", () => {
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("api.example.com", "example.com")).toBe(true);
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
    expect(domainMatches("example.com", "com")).toBe(true); // suffix match per RFC
  });

  it("path-matches per RFC 6265 5.1.4", () => {
    expect(pathMatches("/", "/")).toBe(true);
    expect(pathMatches("/a/b", "/")).toBe(true);
    expect(pathMatches("/a/b", "/a")).toBe(true);
    expect(pathMatches("/ab", "/a")).toBe(false);
    expect(pathMatches("/a/b", "/a/b")).toBe(true);
    expect(pathMatches("/a/bc", "/a/b")).toBe(false);
  });
});

describe("CookieJar capture from responses (G1)", () => {
  it("stores host-only cookies keyed to the response host", () => {
    const jar = new CookieJar();
    jar.setFromResponse(
      "https://api.example.com/login",
      [setCookie("sid", "abc", { path: "/", secure: true })],
      NOW,
    );
    expect(jar.count()).toBe(1);
    const [c] = jar.all();
    expect(c.domain).toBe("api.example.com");
    expect(c.hostOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.path).toBe("/");
  });

  it("honors a Domain attribute and strips the leading dot", () => {
    const jar = new CookieJar();
    jar.setFromResponse(
      "https://api.example.com/login",
      [setCookie("lang", "en", { domain: ".example.com", path: "/app" })],
      NOW,
    );
    const [c] = jar.all();
    expect(c.domain).toBe("example.com");
    expect(c.hostOnly).toBe(false);
  });

  it("rejects a Domain attribute that does not match the request host", () => {
    const jar = new CookieJar();
    jar.setFromResponse(
      "https://api.example.com/login",
      [setCookie("evil", "x", { domain: "other.com" })],
      NOW,
    );
    const [c] = jar.all();
    expect(c.domain).toBe("api.example.com");
    expect(c.hostOnly).toBe(true);
  });

  it("replaces an existing cookie with the same domain/path/name", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/", [setCookie("sid", "one")], NOW);
    jar.setFromResponse("https://example.com/", [setCookie("sid", "two")], NOW + 1000);
    expect(jar.count()).toBe(1);
    expect(jar.all()[0].value).toBe("two");
    expect(jar.all()[0].created).toBe(NOW); // preserves original creation time
  });

  it("honors max-age and deletes on max-age <= 0", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/", [setCookie("a", "1", { maxAge: 60 })], NOW);
    jar.setFromResponse("https://example.com/", [setCookie("b", "2", { maxAge: 0 })], NOW);
    expect(jar.all().map((c) => c.key).sort()).toEqual(["a"]);
    expect(jar.all()[0].expires).toBe(NOW + 60000);
  });

  it("parses an RFC-date expires attribute", () => {
    const jar = new CookieJar();
    jar.setFromResponse(
      "https://example.com/",
      [setCookie("a", "1", { expires: "Wed, 21 Oct 2026 07:28:00 GMT" })],
      NOW,
    );
    expect(jar.all()[0].expires).toBe(Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"));
  });
});

describe("CookieJar matching for sends (G1 auto-attach)", () => {
  const jar = new CookieJar();
  jar.setFromResponse("https://example.com/login", [
    setCookie("session", "s1", { path: "/", httpOnly: true }),
    setCookie("theme", "dark", { path: "/", secure: true }),
    setCookie("sub", "v", { path: "/api" }),
  ], NOW);

  it("returns a Cookie header for the same host", () => {
    expect(jar.cookieHeaderFor("https://example.com/api/users", NOW)).toBe(
      "sub=v; session=s1; theme=dark",
    );
  });

  it("excludes secure cookies over plain http", () => {
    const value = jar.cookieHeaderFor("http://example.com/", NOW);
    expect(value).toContain("session=s1");
    expect(value).not.toContain("theme=dark");
  });

  it("excludes cookies whose path does not match", () => {
    const value = jar.cookieHeaderFor("https://example.com/other", NOW);
    expect(value).not.toContain("sub=v");
  });

  it("matches subdomains for domain-scoped cookies", () => {
    const domainJar = new CookieJar();
    domainJar.setFromResponse("https://api.example.com/", [setCookie("lang", "en", { domain: ".example.com" })], NOW);
    expect(domainJar.cookieHeaderFor("https://other.example.com/x", NOW)).toBe("lang=en");
    expect(domainJar.cookieHeaderFor("https://example.org/", NOW)).toBeUndefined();
  });

  it("drops expired cookies from the header", () => {
    const jar2 = new CookieJar();
    jar2.setFromResponse("https://example.com/", [setCookie("gone", "1", { maxAge: 10 })], NOW);
    expect(jar2.cookieHeaderFor("https://example.com/", NOW + 20000)).toBeUndefined();
  });

  it("does not return a header when nothing matches", () => {
    expect(jar.cookieHeaderFor("https://other.org/", NOW)).toBeUndefined();
  });
});

describe("CookieJar manual ops (G2 manager)", () => {
  it("upserts a cookie for a URL and reads it back", () => {
    const jar = new CookieJar();
    jar.upsert("https://example.com/", { key: "manual", value: "yes", secure: true }, NOW);
    expect(jar.cookieHeaderFor("https://example.com/", NOW)).toBe("manual=yes");
  });

  it("deletes by domain/path/name", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/", [setCookie("a", "1")], NOW);
    expect(jar.deleteCookie("example.com", "/", "a")).toBe(true);
    expect(jar.count()).toBe(0);
  });

  it("deletes all cookies scoped to a URL", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/", [setCookie("a", "1"), setCookie("b", "2")], NOW);
    jar.setFromResponse("https://other.com/", [setCookie("c", "3")], NOW);
    expect(jar.deleteCookiesForUrl("https://example.com/x")).toBe(2);
    expect(jar.count()).toBe(1);
  });

  it("deletes every cookie for a domain (exact stored domain)", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.example.com/", [setCookie("a", "1")], NOW);
    jar.setFromResponse("https://www.example.com/", [setCookie("b", "2")], NOW);
    // Host-only cookies are scoped to their exact host: deleting "example.com"
    // does not reach the api/www host-only entries.
    expect(jar.deleteDomain("example.com")).toBe(0);
    expect(jar.deleteDomain("api.example.com")).toBe(1);
    expect(jar.count()).toBe(1);
    expect(jar.all()[0].domain).toBe("www.example.com");
  });

  it("clears the whole jar", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/", [setCookie("a", "1")], NOW);
    jar.clear();
    expect(jar.count()).toBe(0);
  });
});

describe("CookieJar persistence", () => {
  it("serializes and hydrates", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/", [setCookie("a", "1", { httpOnly: true })], NOW);
    const raw = jar.serialize();
    const restored = deserializeCookieJar(raw);
    expect(restored.count()).toBe(1);
    expect(restored.cookieHeaderFor("https://example.com/", NOW)).toBe("a=1");
    expect(restored.all()[0].httpOnly).toBe(true);
  });

  it("returns an empty jar for garbage input", () => {
    expect(deserializeCookieJar(null).count()).toBe(0);
    expect(deserializeCookieJar("not json").count()).toBe(0);
    expect(deserializeCookieJar('{"nope":1}').count()).toBe(0);
  });
});
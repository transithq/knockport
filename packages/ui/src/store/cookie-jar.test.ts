import type { Request, Response, ResponseCookie } from "@knockport/core";
import { CookieJar } from "@knockport/core";
import { describe, expect, it } from "vitest";
import { attachCookieJar, captureResponseCookies } from "./cookie-jar";

function response(url: string, setCookies: ResponseCookie[]): Response {
  return {
    id: "r1",
    requestId: "req1",
    url,
    status: 200,
    statusText: "OK",
    headers: {},
    body: "",
    bodySize: 0,
    contentType: "application/json",
    timings: { total: 1, ttfb: 1 },
    cookies: setCookies,
    timestamp: new Date().toISOString(),
  };
}

function request(url: string, cookieHeader?: string): Request {
  return {
    id: "req1",
    name: "R",
    url,
    method: "GET",
    headers: cookieHeader
      ? [{ key: "Cookie", value: cookieHeader, enabled: true }]
      : [],
    params: [],
    auth: { type: "none" },
    body: { type: "none" },
  };
}

describe("cookie jar capture + attach (G1)", () => {
  it("captures Set-Cookie from a response into the jar", () => {
    const jar = new CookieJar();
    captureResponseCookies(jar, response("https://example.com/login", [
      { name: "sid", value: "abc", path: "/" },
    ]));
    expect(jar.cookieHeaderFor("https://example.com/")).toBe("sid=abc");
  });

  it("attachCookieJar adds a Cookie header for the request URL", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/login", [{ name: "sid", value: "abc", path: "/" }]);
    const out = attachCookieJar(request("https://example.com/"), jar);
    expect(out.headers).toContainEqual({ key: "Cookie", value: "sid=abc", enabled: true });
  });

  it("does not overwrite an explicit Cookie header (explicit wins)", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://example.com/login", [{ name: "sid", value: "abc", path: "/" }]);
    const out = attachCookieJar(request("https://example.com/", "manual=1"), jar);
    expect(out.headers).toEqual([{ key: "Cookie", value: "manual=1", enabled: true }]);
  });

  it("returns the request unchanged when no cookies match", () => {
    const jar = new CookieJar();
    const req = request("https://other.org/");
    expect(attachCookieJar(req, jar)).toBe(req);
  });
});
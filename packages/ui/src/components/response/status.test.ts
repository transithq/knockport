import { describe, expect, it } from "vitest";
import { statusGroup, statusGroupColor, statusLabel, statusPhrase } from "./status";

describe("statusGroup", () => {
  it("classifies standard ranges", () => {
    expect(statusGroup(200)).toBe("2xx");
    expect(statusGroup(299)).toBe("2xx");
    expect(statusGroup(301)).toBe("3xx");
    expect(statusGroup(404)).toBe("4xx");
    expect(statusGroup(500)).toBe("5xx");
    expect(statusGroup(599)).toBe("5xx");
  });

  it("rejects errors and non-standard ranges", () => {
    expect(statusGroup(0)).toBeNull();
    expect(statusGroup(-1)).toBeNull();
    expect(statusGroup(Number.NaN)).toBeNull();
    expect(statusGroup(100)).toBeNull();
    expect(statusGroup(600)).toBeNull();
  });
});

describe("statusGroupColor", () => {
  it("maps groups to the --kp-status-* tokens", () => {
    expect(statusGroupColor(204)).toBe("var(--kp-status-2xx)");
    expect(statusGroupColor(304)).toBe("var(--kp-status-3xx)");
    expect(statusGroupColor(429)).toBe("var(--kp-status-4xx)");
    expect(statusGroupColor(503)).toBe("var(--kp-status-5xx)");
  });

  it("returns undefined for error/unknown statuses", () => {
    expect(statusGroupColor(0)).toBeUndefined();
    expect(statusGroupColor(199)).toBeUndefined();
  });
});

describe("statusPhrase", () => {
  it("covers the common RFC 9110 codes", () => {
    expect(statusPhrase(200)).toBe("OK");
    expect(statusPhrase(201)).toBe("Created");
    expect(statusPhrase(204)).toBe("No Content");
    expect(statusPhrase(401)).toBe("Unauthorized");
    expect(statusPhrase(418)).toBe("I'm a Teapot");
    expect(statusPhrase(500)).toBe("Internal Server Error");
  });

  it("returns empty string for unknown codes", () => {
    expect(statusPhrase(999)).toBe("");
    expect(statusPhrase(0)).toBe("");
  });
});

describe("statusLabel", () => {
  it("prefers the server reason phrase", () => {
    expect(statusLabel(200, "OK")).toBe("200 OK");
    expect(statusLabel(200, "All Good")).toBe("200 All Good");
  });

  it("falls back to the IANA phrase (HTTP/2 strips reason phrases)", () => {
    expect(statusLabel(404, "")).toBe("404 Not Found");
    expect(statusLabel(503)).toBe("503 Service Unavailable");
    expect(statusLabel(404, "   ")).toBe("404 Not Found");
  });

  it("returns the bare code when nothing is known", () => {
    expect(statusLabel(0)).toBe("0");
    expect(statusLabel(999, "")).toBe("999");
  });
});

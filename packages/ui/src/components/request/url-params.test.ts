import { describe, expect, it } from "vitest";
import { displayUrl, parseQuery, splitQuery } from "./url-params";

describe("splitQuery", () => {
  it("splits at the first ?", () => {
    expect(splitQuery("https://x.dev/a?b=1?c=2")).toEqual(["https://x.dev/a", "b=1?c=2"]);
  });
  it("returns null query when absent", () => {
    expect(splitQuery("https://x.dev/a")).toEqual(["https://x.dev/a", null]);
  });
});

describe("displayUrl", () => {
  it("appends enabled params with ?", () => {
    expect(
      displayUrl("https://x.dev/get", [
        { key: "hello", value: "world", enabled: true },
        { key: "off", value: "x", enabled: false },
      ]),
    ).toBe("https://x.dev/get?hello=world");
  });
  it("keeps query already baked into the URL first", () => {
    expect(
      displayUrl("https://x.dev/get?a=1", [{ key: "b", value: "2", enabled: true }]),
    ).toBe("https://x.dev/get?a=1&b=2");
  });
  it("skips empty keys and encodes spaces like the wire format", () => {
    expect(
      displayUrl("https://x.dev/get", [
        { key: "", value: "x", enabled: true },
        { key: "q", value: "two words", enabled: true },
      ]),
    ).toBe("https://x.dev/get?q=two%20words");
  });
  it("leaves {{variables}} untouched", () => {
    expect(displayUrl("{{baseUrl}}/users", [{ key: "token", value: "{{t}}", enabled: true }])).toBe(
      "{{baseUrl}}/users?token={{t}}",
    );
  });
});

describe("parseQuery", () => {
  it("parses pairs, dropping empty keys", () => {
    expect(parseQuery("a=1&b=2")).toEqual([
      { key: "a", value: "1", enabled: true },
      { key: "b", value: "2", enabled: true },
    ]);
  });
  it("parses valueless keys as empty strings", () => {
    expect(parseQuery("flag&x=1")).toEqual([
      { key: "flag", value: "", enabled: true },
      { key: "x", value: "1", enabled: true },
    ]);
  });
  it("decodes encoded values and plus-as-space", () => {
    expect(parseQuery("q=two+words&s=a%26b")).toEqual([
      { key: "q", value: "two words", enabled: true },
      { key: "s", value: "a&b", enabled: true },
    ]);
  });
  it("round-trips displayUrl output back into params", () => {
    const [, query] = splitQuery(
      displayUrl("https://x.dev/get", [
        { key: "a", value: "1", enabled: true },
        { key: "q", value: "two words", enabled: true },
      ]),
    );
    const params = parseQuery(query ?? "");
    expect(params).toEqual([
      { key: "a", value: "1", enabled: true },
      { key: "q", value: "two words", enabled: true },
    ]);
  });
});

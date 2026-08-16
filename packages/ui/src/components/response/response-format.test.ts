import { describe, expect, it } from "vitest";
import { detectResponseFormat, formatLabel } from "./response-format";

describe("detectResponseFormat", () => {
  it("maps application/json (with charset) to json confidently", () => {
    const r = detectResponseFormat("application/json; charset=utf-8", "{}");
    expect(r.format).toBe("json");
    expect(r.confident).toBe(true);
  });

  it("maps +json vendor types to json", () => {
    expect(detectResponseFormat("application/vnd.api+json", "{}").format).toBe("json");
    expect(detectResponseFormat("application/ld+json", "{}").format).toBe("json");
  });

  it("maps xml and html content types", () => {
    expect(detectResponseFormat("application/xml", "<a/>").format).toBe("xml");
    expect(detectResponseFormat("text/xml", "<a/>").format).toBe("xml");
    expect(detectResponseFormat("text/html", "<html></html>").format).toBe("html");
  });

  it("maps javascript content types", () => {
    expect(detectResponseFormat("application/javascript", "var x=1;").format).toBe("javascript");
    expect(detectResponseFormat("text/javascript", "var x=1;").format).toBe("javascript");
  });

  it("sniffs JSON when declared type is plain text", () => {
    const r = detectResponseFormat("text/plain", '{"a":1}');
    expect(r.format).toBe("json");
    expect(r.confident).toBe(true);
  });

  it("sniffs JSON when content type is missing", () => {
    expect(detectResponseFormat(undefined, "[1,2,3]").format).toBe("json");
  });

  it("does not sniff invalid JSON objects", () => {
    expect(detectResponseFormat("text/plain", '{"a":1,' /* truncated */).format).toBe("text");
    expect(detectResponseFormat("text/plain", "hello").format).toBe("text");
  });

  it("keeps unknown binary-ish types as text", () => {
    expect(detectResponseFormat("application/octet-stream", "x").format).toBe("text");
  });

  it("formatLabel returns human labels", () => {
    expect(formatLabel("json")).toBe("JSON");
    expect(formatLabel("javascript")).toBe("JavaScript");
  });
});

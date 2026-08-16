import { describe, expect, it } from "vitest";
import { parseSseFrame, takeCompleteFrames } from "./sse-parse";

describe("parseSseFrame", () => {
  it("parses a default message frame", () => {
    expect(parseSseFrame("data: hello")).toEqual({ event: "message", data: "hello" });
  });

  it("joins multiple data lines with newlines", () => {
    expect(parseSseFrame("data: a\ndata: b")).toEqual({ event: "message", data: "a\nb" });
  });

  it("reads event and id fields", () => {
    expect(parseSseFrame("event: add\ndata: {}\nid: 42")).toEqual({
      event: "add",
      data: "{}",
      id: "42",
    });
  });

  it("skips comments and blank lines, tolerates CR and missing space", () => {
    expect(parseSseFrame(": keep-alive\r\n\r\ndata:nospace")).toEqual({
      event: "message",
      data: "nospace",
    });
  });

  it("returns null for frames with no data and no event", () => {
    expect(parseSseFrame(": only a comment")).toBeNull();
    expect(parseSseFrame("")).toBeNull();
  });
});

describe("takeCompleteFrames", () => {
  it("splits complete frames and keeps the partial tail", () => {
    const [frames, rest] = takeCompleteFrames("data: 1\n\ndata: 2\n\ndata: par");
    expect(frames).toEqual(["data: 1", "data: 2"]);
    expect(rest).toBe("data: par");
  });

  it("returns everything as remainder when no blank line yet", () => {
    const [frames, rest] = takeCompleteFrames("data: partial only");
    expect(frames).toEqual([]);
    expect(rest).toBe("data: partial only");
  });
});

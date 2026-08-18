import { describe, expect, it } from "vitest";
import {
  isBinaryContentType,
  isMediaContentType,
  mediaKind,
  normalizeContentType,
} from "./media";

describe("media content-type detection (F1)", () => {
  it("normalizes to lowercase type/subtype, dropping parameters", () => {
    expect(normalizeContentType("Image/PNG")).toBe("image/png");
    expect(normalizeContentType("text/html; charset=utf-8")).toBe("text/html");
    expect(normalizeContentType(undefined)).toBe("");
  });

  it("classifies renderable media kinds", () => {
    expect(mediaKind("image/png")).toBe("image");
    expect(mediaKind("image/svg+xml")).toBe("image");
    expect(mediaKind("audio/mpeg")).toBe("audio");
    expect(mediaKind("video/mp4")).toBe("video");
    expect(mediaKind("application/pdf")).toBe("pdf");
    expect(mediaKind("text/html")).toBeNull();
    expect(mediaKind("application/json")).toBeNull();
    expect(mediaKind(undefined)).toBeNull();
  });

  it("flags media types as binary", () => {
    expect(isBinaryContentType("image/png")).toBe(true);
    expect(isBinaryContentType("video/webm")).toBe(true);
    expect(isBinaryContentType("application/pdf")).toBe(true);
    expect(isBinaryContentType("text/html")).toBe(false);
    expect(isBinaryContentType(undefined)).toBe(false);
  });

  it("flags other opaque binary families (download-only)", () => {
    expect(isBinaryContentType("application/octet-stream")).toBe(true);
    expect(isBinaryContentType("application/zip")).toBe(true);
    expect(isBinaryContentType("font/woff2")).toBe(true);
    expect(isMediaContentType("application/octet-stream")).toBe(false);
  });
});
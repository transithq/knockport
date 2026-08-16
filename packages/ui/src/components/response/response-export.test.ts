import { describe, expect, it } from "vitest";
import { filenameForResponse, filenameFromUrl } from "./response-export";

describe("filenameFromUrl", () => {
  it("uses the last path segment without its extension", () => {
    expect(filenameFromUrl("https://api.test/users/42/details.html")).toBe("details");
    expect(filenameFromUrl("https://api.test/v1/users")).toBe("users");
  });

  it("falls back for root paths and junk URLs", () => {
    expect(filenameFromUrl("https://api.test/")).toBe("response");
    expect(filenameFromUrl("not a url")).toBe("response");
    expect(filenameFromUrl("")).toBe("response");
  });

  it("sanitizes unsafe characters", () => {
    expect(filenameFromUrl("https://api.test/search?q=a/b")).toBe("search");
  });
});

describe("filenameForResponse", () => {
  it("pairs URL stem with content-type extension", () => {
    expect(filenameForResponse("https://api.test/users", "application/json", "{}")).toBe("users.json");
    expect(filenameForResponse("https://api.test/feed", "application/atom+xml", "<x/>")).toBe("feed.xml");
    expect(filenameForResponse("https://api.test/page", "text/html", "<html></html>")).toBe("page.html");
  });

  it("sniffs JSON for untyped bodies", () => {
    expect(filenameForResponse("https://api.test/data", undefined, '{"a":1}')).toBe("data.json");
    expect(filenameForResponse("https://api.test/data", "text/plain", "hello")).toBe("data.txt");
  });
});

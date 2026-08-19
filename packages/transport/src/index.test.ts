import { describe, expect, it, vi } from "vitest";
import type { Request } from "@knockport/core";
import {
  DirectTransport,
  RelayTransport,
  buildBody,
  buildHeaderList,
  encodeUrl,
  optionsForRequest,
  parseSetCookie,
  parseSetCookies,
} from "./index";

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: "q1",
    name: "q1",
    method: "GET",
    url: "https://example.com/image.png",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "none" },
    ...overrides,
  };
}

describe("parseSetCookie", () => {
  it("parses a minimal cookie", () => {
    const c = parseSetCookie("sid=abc123");
    expect(c).toEqual({ name: "sid", value: "abc123" });
  });

  it("parses all attributes", () => {
    const c = parseSetCookie(
      "id=a3fWa; Domain=example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; HttpOnly; Secure; SameSite=Strict",
    );
    expect(c).toMatchObject({
      name: "id",
      value: "a3fWa",
      domain: "example.com",
      path: "/",
      expires: "Wed, 21 Oct 2026 07:28:00 GMT",
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });
  });

  it("keeps '=' intact inside Expires attribute values", () => {
    const c = parseSetCookie("t=x; Expires=Thu, 01 Jan 2027 00:00:00 GMT");
    expect(c?.expires).toBe("Thu, 01 Jan 2027 00:00:00 GMT");
  });

  it("handles cookie values containing '='", () => {
    const c = parseSetCookie("token=abc=def==; Path=/");
    expect(c).toMatchObject({ name: "token", value: "abc=def==", path: "/" });
  });

  it("handles empty values", () => {
    const c = parseSetCookie("cleared=; Max-Age=0");
    expect(c).toMatchObject({ name: "cleared", value: "", maxAge: 0 });
  });

  it("rejects lines without a name=value pair", () => {
    expect(parseSetCookie("")).toBeNull();
    expect(parseSetCookie("invalid")).toBeNull();
    expect(parseSetCookie("=onlyvalue")).toBeNull();
  });
});

describe("parseSetCookies", () => {
  it("parses one cookie per header value", () => {
    const cookies = parseSetCookies([
      "a=1; HttpOnly",
      "b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure",
    ]);
    expect(cookies).toHaveLength(2);
    expect(cookies[0].name).toBe("a");
    expect(cookies[1].name).toBe("b");
    expect(cookies[1].expires).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
  });
});


// ── GraphQL wire envelope ────────────────────────────────────────────────────
describe("graphql body serialization", () => {
  const gqlRequest: Request = {
    id: "r1",
    name: "q",
    method: "POST",
    url: "https://api.example.com/graphql",
    headers: [],
    params: [],
    body: {
      type: "graphql",
      graphql: { query: "query { user { name } }", variables: "{\"id\": 1}" },
    },
    auth: { type: "none" },
  };

  it("serializes query + parsed variables into the JSON envelope", () => {
    const body = buildBody(gqlRequest);
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toEqual({
      query: "query { user { name } }",
      variables: { id: 1 },
    });
  });

  it("omits variables when empty or invalid", () => {
    const empty = buildBody({ ...gqlRequest, body: { type: "graphql", graphql: { query: "q", variables: "" } } });
    expect(JSON.parse(empty as string)).toEqual({ query: "q" });
    const invalid = buildBody({ ...gqlRequest, body: { type: "graphql", graphql: { query: "q", variables: "not json" } } });
    expect(JSON.parse(invalid as string)).toEqual({ query: "q" });
  });

  it("injects content-type application/json when unset", () => {
    const headers = buildHeaderList(gqlRequest);
    expect(headers).toContainEqual({ key: "Content-Type", value: "application/json" });
  });

  it("never overrides a user-set content-type", () => {
    const headers = buildHeaderList({
      ...gqlRequest,
      headers: [{ key: "content-type", value: "application/graphql", enabled: true }],
    });
    expect(headers).toContainEqual({ key: "content-type", value: "application/graphql" });
    expect(headers.filter((h) => h.key.toLowerCase() === "content-type")).toHaveLength(1);
  });
});

describe("binary body upload (E1)", () => {
  it("buildBody returns the File for binary bodies (fetch BodyInit)", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.bin", { type: "application/octet-stream" });
    const body = buildBody(makeRequest({ method: "POST", body: { type: "binary", file } }));
    expect(body).toBe(file);
  });

  it("buildBody falls back to legacy text content for binary bodies", () => {
    const body = buildBody(makeRequest({ method: "POST", body: { type: "binary", content: "raw" } }));
    expect(body).toBe("raw");
  });

  it("relay sends binary files as base64 wire parts with octet-stream default", async () => {
    const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef])], "blob.bin", {
      type: "application/octet-stream",
    });
    const relay = {
      status: 200,
      statusText: "OK",
      headers: [],
      body: "",
      encoding: "utf8",
      timings: { total: 50, ttfb: 10, download: 40 },
    };
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(relay),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const req = makeRequest({ method: "POST", body: { type: "binary", file } });
      await new RelayTransport("https://relay.example").execute(req);
      const [, init] = fetchStub.mock.calls[0];
      const wire = JSON.parse(init.body);
      expect(wire.binary).toBeDefined();
      expect(wire.binary.content_type).toBe("application/octet-stream");
      expect(wire.binary.data_base64).toBe("3q2+7w==");
      expect(wire.body).toBeUndefined();
      expect(wire.headers).not.toContainEqual(expect.objectContaining({ key: "Content-Type" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("relay honors a user content-type override on binary bodies", async () => {
    const file = new File([new Uint8Array([1])], "a.bin");
    const relay = {
      status: 200,
      statusText: "OK",
      headers: [],
      body: "",
      encoding: "utf8",
      timings: { total: 50, ttfb: 10, download: 40 },
    };
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(relay),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const req = makeRequest({
        method: "POST",
        headers: [{ key: "Content-Type", value: "image/svg+xml", enabled: true }],
        body: { type: "binary", file },
      });
      await new RelayTransport("https://relay.example").execute(req);
      const [, init] = fetchStub.mock.calls[0];
      const wire = JSON.parse(init.body);
      expect(wire.binary.content_type).toBe("image/svg+xml");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("per-part contentType for multipart (E2)", () => {
  it("buildBody wraps text and file parts with their explicit content-type", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.bin", { type: "application/octet-stream" });
    const req = makeRequest({
      method: "POST",
      body: {
        type: "multipart-form",
        formData: [
          { key: "note", value: "hi", type: "text", enabled: true, contentType: "text/plain" },
          { key: "up", value: file, type: "file", enabled: true, contentType: "image/png" },
          { key: "plain", value: "x", type: "text", enabled: true },
        ],
      },
    });
    const form = buildBody(req) as FormData;
    expect((form.get("note") as File).type).toBe("text/plain");
    expect((form.get("up") as File).type).toBe("image/png");
    expect(typeof form.get("plain")).toBe("string");
    expect((form.get("up") as File).name).toBe("a.bin");
  });

  it("relay wire passes per-part contentType on text and file parts", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.bin");
    const relay = {
      status: 200,
      statusText: "OK",
      headers: [],
      body: "",
      encoding: "utf8",
      timings: { total: 50, ttfb: 10, download: 40 },
    };
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(relay),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const req = makeRequest({
        method: "POST",
        body: {
          type: "multipart-form",
          formData: [
            { key: "note", value: "hi", type: "text", enabled: true, contentType: "text/plain" },
            { key: "up", value: file, type: "file", enabled: true, contentType: "image/png" },
            { key: "plain", value: "x", type: "text", enabled: true },
          ],
        },
      });
      await new RelayTransport("https://relay.example").execute(req);
      const [, init] = fetchStub.mock.calls[0];
      const wire = JSON.parse(init.body);
      expect(wire.multipart).toHaveLength(3);
      expect(wire.multipart[0]).toMatchObject({ name: "note", value: "hi", content_type: "text/plain" });
      expect(wire.multipart[1]).toMatchObject({ name: "up", content_type: "image/png" });
      expect(wire.multipart[2].content_type).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("per-request settings (E4)", () => {
  it("encodeUrl content-blind-encodes path + query, preserving origin", () => {
    expect(encodeUrl("https://example.com/api/users?name=Jane Doe&q=%20")).toBe(
      "https://example.com/api/users?name=Jane%20Doe&q=%2520",
    );
    expect(encodeUrl("https://example.com/a b/c")).toBe("https://example.com/a%20b/c");
    expect(encodeUrl("http://localhost:8080/x?token=abc#def")).toBe(
      "http://localhost:8080/x?token=abc%23def",
    );
    expect(encodeUrl("")).toBe("");
  });

  it("optionsForRequest applies Bruno DEFAULT_SETTINGS semantics", () => {
    const base = makeRequest({ method: "GET", url: "https://example.com" });
    const opts = optionsForRequest(base, { defaultTimeoutMs: 30000 });
    expect(opts.timeout).toBe(30000);
    expect(opts.followRedirects).toBeUndefined(); // default on at the transports
    expect(opts.encodeUrl).toBeUndefined();

    const custom: Request = {
      ...base,
      settings: { followRedirects: false, maxRedirects: 2, timeout: 1500, encodeUrl: true },
    };
    const resolved = optionsForRequest(custom, { defaultTimeoutMs: 30000 });
    expect(resolved).toMatchObject({ followRedirects: false, maxRedirects: 2, timeout: 1500, encodeUrl: true });

    const zero = optionsForRequest({ ...base, settings: { timeout: 0 } }, { defaultTimeoutMs: 5000 });
    expect(zero.timeout).toBe(5000); // 0 = inherit
  });

  it("relay wire sends settings (follow_redirects, max_redirects, timeout_ms)", async () => {
    const relay = { status: 200, statusText: "OK", headers: [], body: "", encoding: "utf8", timings: { total: 50, ttfb: 10, download: 40 } };
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(relay),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const req = makeRequest({
        method: "GET",
        url: "https://example.com",
        settings: { followRedirects: false, maxRedirects: 2, timeout: 1500 },
      });
      const options = optionsForRequest(req, { defaultTimeoutMs: 30000 });
      await new RelayTransport("https://relay.example").execute(req, options);
      const [, init] = fetchStub.mock.calls[0];
      const wire = JSON.parse(init.body);
      expect(wire.settings).toEqual({ follow_redirects: false, max_redirects: 2, timeout_ms: 1500 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("DirectTransport binary capture (F1)", () => {
  it("base64-encodes media bodies and leaves the text body empty", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const headers = new Map<string, string>([["content-type", "image/png"]]);
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (k: string) => headers.get(k.toLowerCase()) ?? null,
        forEach: (cb: (v: string, k: string) => void) => headers.forEach((v, k) => cb(v, k)),
      },
      arrayBuffer: () => Promise.resolve(png.buffer),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const res = await new DirectTransport().execute(makeRequest());
      expect(res.body).toBe("");
      expect(res.bodyBase64).toBe("iVBORw0KGgo=");
      expect(res.bodySize).toBe(8);
      expect(res.contentType).toBe("image/png");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps text capture for text responses (no bodyBase64)", async () => {
    const headers = new Map<string, string>([["content-type", "application/json"]]);
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (k: string) => headers.get(k.toLowerCase()) ?? null,
        forEach: (cb: (v: string, k: string) => void) => headers.forEach((v, k) => cb(v, k)),
      },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      text: () => Promise.resolve('{"ok":true}'),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const res = await new DirectTransport().execute(makeRequest());
      expect(res.body).toBe('{"ok":true}');
      expect(res.bodyBase64).toBeUndefined();
      expect(res.bodySize).toBe(11);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("RelayTransport binary capture (F1)", () => {
  it("keeps base64 bytes for media responses", async () => {
    const headers = new Map<string, string>([["content-type", "image/png"]]);
    const relay = {
      status: 200,
      statusText: "OK",
      headers: [{ key: "content-type", value: "image/png" }],
      body: "iVBORw0KGgo=",
      encoding: "base64",
      timings: { total: 50, ttfb: 10, download: 40 },
    };
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      json: () => Promise.resolve(relay),
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const res = await new RelayTransport("https://relay.example").execute(makeRequest());
      expect(res.body).toBe("");
      expect(res.bodyBase64).toBe("iVBORw0KGgo=");
      expect(res.bodySize).toBe(8);
      expect(res.contentType).toBe("image/png");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

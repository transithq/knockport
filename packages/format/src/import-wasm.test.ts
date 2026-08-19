import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureTropelInput, importAnyAsCollection, isTropelInputReady } from "./import-wasm";
import { scenarioToCollection } from "./scenario";

// Drive the REAL @tropel/input-wasm slice: the same wasm bundle apps/web
// fetches when the import modal opens (the file: dependency of
// packages/format). Bytes read up front — with the file: dep hardlinked into
// the pnpm store, the pkg directory can go stale between runs while the
// .wasm bytes are immutable.
const require = createRequire(import.meta.url);
const facadePath = require.resolve("@tropel/input-wasm");
const wasmPath = join(dirname(facadePath), "..", "pkg", "tropel_input_wasm_bg.wasm");
const wasmBytes = readFileSync(wasmPath);

const text = (s: string) => new TextEncoder().encode(s);

const OPENAPI = text(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Pets", version: "1.0.0" },
    servers: [{ url: "https://api.example.com/v1" }],
    paths: {
      "/pets": {
        get: {
          summary: "List pets",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { "200": { description: "ok" } },
        },
        post: {
          summary: "Create pet",
          requestBody: {
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { "201": { description: "created" } },
        },
      },
    },
  }),
);

const POSTMAN = text(
  JSON.stringify({
    info: {
      name: "Smoke Collection",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      {
        name: "Users",
        item: [
          {
            name: "GET Users",
            request: { method: "GET", url: { raw: "https://api.example.com/users" } },
          },
        ],
      },
    ],
  }),
);

const HAR = text(
  JSON.stringify({
    log: {
      version: "1.2",
      entries: [
        {
          request: {
            method: "GET",
            url: "https://example.com/?q=1",
            headers: [{ name: "Accept", value: "application/json" }],
            queryString: [{ name: "q", value: "1" }],
          },
          response: { status: 200, statusText: "OK" },
        },
      ],
    },
  }),
);

beforeAll(async () => {
  const ok = await ensureTropelInput({ wasmBytes });
  expect(ok).toBe(true);
});

describe("tropel input slice (real wasm)", () => {
  it("inits and detects all three formats", () => {
    expect(isTropelInputReady()).toBe(true);
  });

  it("imports an OpenAPI 3.x spec to a collection with servers applied", () => {
    const result = importAnyAsCollection(OPENAPI);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("openapi");
    const col = result!.collection;
    expect(col.name).toBe("Pets");
    expect(col.requests).toHaveLength(2);
    // tropel prepends servers[0].url and substitutes path params
    expect(col.requests[0].url).toContain("https://api.example.com/v1");
    expect(col.requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    const create = col.requests[1];
    expect(create.body.type === "json" || create.body.type === "text").toBe(true);
  });

  it("imports a Postman collection with nested folders", () => {
    const result = importAnyAsCollection(POSTMAN);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("postman");
    const col = result!.collection;
    expect(col.name).toBe("Smoke Collection");
    expect(col.folders).toHaveLength(1);
    expect(col.folders[0].name).toBe("Users");
    expect(col.folders[0].requests[0].url).toBe("https://api.example.com/users");
  });

  it("imports a HAR as a request list", () => {
    const result = importAnyAsCollection(HAR);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("har");
    const col = result!.collection;
    expect(col.requests).toHaveLength(1);
    // HAR adapter keeps the query string in the URL and does not split params
    expect(col.requests[0].url).toBe("https://example.com/?q=1");
    expect(col.requests[0].params).toEqual([]);
    expect(col.requests[0].headers).toContainEqual({
      key: "Accept",
      value: "application/json",
      enabled: true,
    });
  });

  it("returns null for unrecognized bytes (TS fallback path)", () => {
    expect(importAnyAsCollection(text("curl -X GET https://example.com"))).toBeNull();
    expect(importAnyAsCollection(text("not a document"))).toBeNull();
  });

  it("maps the real scenario JSON through scenarioToCollection (shared path)", async () => {
    const { importAny } = await import("@tropel/input-wasm");
    const scenarioJson = importAny(OPENAPI);
    const col = scenarioToCollection(scenarioJson);
    expect(col.name).toBe("Pets");
    expect(col.requests).toHaveLength(2);
    expect(col.requests[0].url).toContain("https://api.example.com/v1");
  });
});
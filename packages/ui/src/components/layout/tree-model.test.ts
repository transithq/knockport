import { describe, expect, it } from "vitest";
import type { Collection, Folder, Request } from "@knockport/core";
import { flattenTree, countRequests } from "./tree-model";

function req(id: string, name: string): Request {
  return {
    id,
    name,
    method: "GET",
    url: "https://x.test",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "none" },
  };
}

function makeCollection(): Collection {
  const subFolder: Folder = {
    id: "fld_sub",
    name: "Sub",
    folders: [],
    requests: [req("req_deep", "Deep")],
    order: [],
  };
  const folder: Folder = {
    id: "fld_1",
    name: "Top",
    folders: [subFolder],
    requests: [req("req_2", "Two")],
    order: [],
  };
  return {
    id: "col_1",
    name: "Col",
    variables: [],
    folders: [folder],
    requests: [req("req_1", "One")],
    order: [],
  };
}

describe("flattenTree", () => {
  it("walks depth-first with correct depths", () => {
    const rows = flattenTree([makeCollection()], new Set());
    expect(rows.map((r) => r.id)).toEqual(["col_1", "fld_1", "fld_sub", "req_deep", "req_2", "req_1"]);
    const depths = rows.map((r) => (r.kind === "collection" ? 0 : r.depth));
    expect(depths).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it("collapsing a collection hides its whole subtree", () => {
    const rows = flattenTree([makeCollection()], new Set(["col_1"]));
    expect(rows.map((r) => r.id)).toEqual(["col_1"]);
  });

  it("collapsing a folder hides its children only", () => {
    const rows = flattenTree([makeCollection()], new Set(["fld_sub"]));
    expect(rows.map((r) => r.id)).toEqual(["col_1", "fld_1", "fld_sub", "req_2", "req_1"]);
  });

  it("stays fast on large forests", () => {
    const big: Collection = {
      id: "col_big",
      name: "Big",
      variables: [],
      folders: [],
      requests: Array.from({ length: 50_000 }, (_, i) => req(`r_${i}`, `Request ${i}`)),
      order: [],
    };
    const t0 = performance.now();
    const rows = flattenTree([big], new Set());
    const ms = performance.now() - t0;
    expect(rows).toHaveLength(50_001);
    expect(ms).toBeLessThan(500);
  });
});

describe("countRequests", () => {
  it("counts requests recursively", () => {
    expect(countRequests(makeCollection())).toBe(3);
  });
});

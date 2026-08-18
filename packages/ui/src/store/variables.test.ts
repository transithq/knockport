import type { Collection, Environment, Folder, Request } from "@knockport/core";
import { describe, expect, it } from "vitest";
import {
  buildVariableMap,
  effectiveAssertions,
  effectiveAuth,
  effectiveHeaders,
  effectivePostScripts,
  effectivePreScripts,
  effectiveScriptLayers,
  effectiveTestScripts,
  environmentVariableMap,
  findFolderPath,
  folderVariablesFor,
  requestVariableMap,
} from "./variables";

function env(id: string, name: string, vars: [string, string][], isDefault = false): Environment {
  return {
    id,
    name,
    isDefault,
    variables: vars.map(([key, value]) => ({ key, value, enabled: true })),
  };
}

const collection: Collection = {
  id: "col1",
  name: "C",
  variables: [{ key: "base", value: "collection", enabled: true }],
  folders: [],
  requests: [],
  order: [],
  auth: { type: "none" },
  metadata: { createdAt: "", updatedAt: "" },
};

function state(active: string | null, envs: Environment[]) {
  return { collections: [collection], environments: envs, activeEnvironmentId: active };
}

describe("buildVariableMap (D3 runner env override)", () => {
  const globals = env("env-global", "Global", [["shared", "globals"], ["gkey", "g"]], true);
  const active = env("env-active", "Active", [["shared", "active"], ["akey", "a"]]);
  const picked = env("env-picked", "Picked", [["shared", "picked"], ["pkey", "p"]]);

  it("baseline precedence: globals < collection < active env", () => {
    const map = buildVariableMap(state("env-active", [globals, active, picked]));
    expect(map.shared).toBe("active");
    expect(map.base).toBe("collection");
    expect(map.gkey).toBe("g");
    expect(map.pkey).toBeUndefined();
  });

  it("runner env overrides the active environment", () => {
    const map = buildVariableMap(state("env-active", [globals, active, picked]), {
      runnerEnv: picked,
      includeActiveEnv: false,
    });
    expect(map.shared).toBe("picked");
    expect(map.pkey).toBe("p");
    expect(map.akey).toBeUndefined();
  });

  it("includeActiveEnv merges the active env underneath the runner env", () => {
    const map = buildVariableMap(state("env-active", [globals, active, picked]), {
      runnerEnv: picked,
      includeActiveEnv: true,
    });
    expect(map.shared).toBe("picked");
    expect(map.pkey).toBe("p");
    expect(map.akey).toBe("a");
    expect(map.gkey).toBe("g");
  });
});

describe("environmentVariableMap (pm.environment scope)", () => {
  const active = env("env-active", "Active", [["k", "active"]]);
  const picked = env("env-picked", "Picked", [["k", "picked"], ["other", "x"]]);

  it("returns the active env without an override", () => {
    expect(environmentVariableMap(state("env-active", [active, picked]))).toEqual({ k: "active" });
  });

  it("returns the runner env with an override", () => {
    expect(
      environmentVariableMap(state("env-active", [active, picked]), {
        runnerEnv: picked,
        includeActiveEnv: false,
      }),
    ).toEqual({ k: "picked", other: "x" });
  });
});

describe("requestVariableMap + request-vars layer (A1)", () => {
  const active = env("env-active", "Active", [
    ["shared", "active"],
    ["envOnly", "envval"],
  ]);

  it("requestVariableMap keeps enabled variables, drops disabled", () => {
    const map = requestVariableMap([
      { key: "a", value: "1", enabled: true },
      { key: "b", value: "2", enabled: false },
      { key: "", value: "3" },
    ]);
    expect(map).toEqual({ a: "1" });
  });

  it("request vars override env vars for the same key", () => {
    const map = buildVariableMap(state("env-active", [active]), undefined, {
      requestVars: [{ key: "shared", value: "reqval" }],
    });
    expect(map.shared).toBe("reqval");
    expect(map.envOnly).toBe("envval");
  });

  it("no request vars leaves the baseline untouched", () => {
    const map = buildVariableMap(state("env-active", [active]));
    expect(map.shared).toBe("active");
  });
});

describe("folder chain + folder variables (A2)", () => {
  const deepRequest: Collection["requests"][number] = {
    id: "req_deep",
    name: "Deep",
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "inherit" },
  };
  const rootRequest: Collection["requests"][number] = { ...deepRequest, id: "req_root", name: "Root" };
  const folderB: Folder = {
    id: "fld_b",
    name: "B",
    variables: [
      { key: "a1", value: "b-wins" },
      { key: "b1", value: "b-val" },
    ],
    folders: [],
    requests: [deepRequest],
    order: [],
  };
  const folderA: Folder = {
    id: "fld_a",
    name: "A",
    variables: [
      { key: "a1", value: "a-val" },
      { key: "off", value: "x", enabled: false },
    ],
    folders: [folderB],
    requests: [],
    order: [],
  };
  const treeCollection: Collection = {
    ...collection,
    folders: [folderA],
    requests: [rootRequest],
  };

  it("findFolderPath returns root→folder chain for a nested request", () => {
    const chain = findFolderPath(treeCollection, "req_deep");
    expect(chain?.map((f) => f.id)).toEqual(["fld_a", "fld_b"]);
  });

  it("findFolderPath returns empty for a collection-root request", () => {
    expect(findFolderPath(treeCollection, "req_root")).toEqual([]);
    expect(findFolderPath(treeCollection, "nope")).toBeUndefined();
  });

  it("folderVariablesFor merges the chain with deeper folders winning", () => {
    const vars = folderVariablesFor(treeCollection, "req_deep");
    expect(vars.find((v) => v.key === "a1")?.value).toBe("b-wins");
    expect(vars.find((v) => v.key === "b1")?.value).toBe("b-val");
  });

  it("folder vars sit between env and request layers", () => {
    const active = env("env-active", "Active", [
      ["a1", "env"],
      ["envOnly", "envval"],
    ]);
    const map = buildVariableMap(
      { collections: [treeCollection], environments: [active], activeEnvironmentId: "env-active" },
      undefined,
      {
        folderVars: folderVariablesFor(treeCollection, "req_deep"),
        requestVars: [{ key: "a1", value: "req" }],
      },
    );
    expect(map.a1).toBe("req"); // request vars win
    expect(map.b1).toBe("b-val"); // folder var
    expect(map.envOnly).toBe("envval");
  });

  it("disabled folder variables are skipped", () => {
    const map = buildVariableMap(
      { collections: [treeCollection], environments: [], activeEnvironmentId: null },
      undefined,
      { folderVars: folderVariablesFor(treeCollection, "req_deep") },
    );
    expect(map.off).toBeUndefined();
  });
});

describe("J1 folder inheritance — headers, auth, scripts, assertions", () => {
  const baseReq: Request = {
    id: "req_leaf",
    name: "Leaf",
    method: "GET",
    url: "",
    headers: [
      { key: "X-Req", value: "req", enabled: true },
      { key: "X-Shared", value: "from-request", enabled: true },
    ],
    params: [],
    body: { type: "none" },
    auth: { type: "inherit" },
    scripts: { pre: "R", postResponse: "R-post", test: "R-test" },
    assertions: [{ expression: "req === true" }],
  };
  const rootReq: Request = { ...baseReq, id: "req_root_j1", name: "RootJ1" };
  const inner: Folder = {
    id: "fld_inner",
    name: "Inner",
    headers: [
      { key: "X-Inner", value: "inner", enabled: true },
      { key: "X-Shared", value: "from-inner", enabled: true },
    ],
    scripts: { pre: "INNER", postResponse: "INNER-post" },
    assertions: [{ expression: "inner === true" }],
    folders: [],
    requests: [baseReq],
    order: [],
  };
  const outer: Folder = {
    id: "fld_outer",
    name: "Outer",
    headers: [
      { key: "X-Outer", value: "outer", enabled: true },
      { key: "X-Shared", value: "from-outer", enabled: true },
    ],
    scripts: { pre: "OUTER", test: "OUTER-test" },
    auth: { type: "bearer", bearer: { token: "folder-token" } },
    assertions: [{ expression: "outer === true" }],
    folders: [inner],
    requests: [],
    order: [],
  };
  const j1Collection: Collection = {
    ...collection,
    auth: { type: "bearer", bearer: { token: "collection-token" } },
    headers: [
      { key: "X-Collection", value: "col", enabled: true },
      { key: "X-Shared", value: "from-collection", enabled: true },
    ],
    scripts: { pre: "COL", postResponse: "COL-post", test: "COL-test" },
    assertions: [{ expression: "col === true" }],
    folders: [outer],
    requests: [rootReq],
  };

  it("effectiveHeaders merges collection, folder chain then request, request wins on dup", () => {
    const headers = effectiveHeaders(baseReq, j1Collection).map((h) => `${h.key}=${h.value}`);
    // Collection headers first, then folder headers (outer then inner by
    // name), then the request's own.
    expect(headers).toContain("X-Collection=col");
    expect(headers).toContain("X-Outer=outer");
    expect(headers).toContain("X-Inner=inner");
    expect(headers).toContain("X-Req=req");
    // Duplicate name: request wins over collection + both folders.
    expect(headers).toContain("X-Shared=from-request");
  });

  it("effectiveHeaders keeps only one entry per duplicate header name", () => {
    const headers = effectiveHeaders(baseReq, j1Collection).filter((h) => h.key === "X-Shared");
    // Collection + both folders define X-Shared, but the request's own entry
    // wins and no ancestor copy survives the merge.
    expect(headers).toHaveLength(1);
    expect(headers[0].value).toBe("from-request");
  });

  it("effectiveAuth resolves inherit against the nearest folder first, then collection", () => {
    // Leaf request → walk chain reverse (inner→outer→collection): inner has no auth, outer wins.
    const leafAuth = effectiveAuth(baseReq, j1Collection);
    expect(leafAuth.type).toBe("bearer");
    expect(leafAuth.bearer?.token).toBe("folder-token");
    // Root request (no folder chain) falls back to the collection auth.
    const rootAuth = effectiveAuth(rootReq, j1Collection);
    expect(rootAuth.bearer?.token).toBe("collection-token");
    // A request with its own auth never inherits.
    const ownAuth = effectiveAuth({ ...baseReq, auth: { type: "none" } }, j1Collection);
    expect(ownAuth.type).toBe("none");
  });

  it("effectivePreScripts orders collection → folders (root→parent) → request", () => {
    expect(effectivePreScripts(baseReq, j1Collection)).toEqual(["COL", "OUTER", "INNER", "R"]);
    // Root request: collection then request only.
    expect(effectivePreScripts(rootReq, j1Collection)).toEqual(["COL", "R"]);
  });

  it("effectivePostScripts and effectiveTestScripts chain the same way", () => {
    expect(effectivePostScripts(baseReq, j1Collection)).toEqual(["COL-post", "INNER-post", "R-post"]);
    expect(effectiveTestScripts(baseReq, j1Collection)).toEqual(["COL-test", "OUTER-test", "R-test"]);
  });

  it("effectiveAssertions concatenates collection + folder chain + request in order", () => {
    const exprs = effectiveAssertions(baseReq, j1Collection).map((a) => a.expression);
    expect(exprs).toEqual([
      "col === true",
      "outer === true",
      "inner === true",
      "req === true",
    ]);
  });
});

describe("J2 collection-level headers", () => {
  const leaf: Request = {
    id: "req_leaf_j2",
    name: "Leaf",
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "inherit" },
  };

  it("collection headers apply to root requests", () => {
    const col: Collection = {
      ...collection,
      headers: [{ key: "X-From-Collection", value: "1", enabled: true }],
      folders: [],
      requests: [leaf],
    };
    const headers = effectiveHeaders(leaf, col).map((h) => `${h.key}=${h.value}`);
    expect(headers).toEqual(["X-From-Collection=1"]);
  });

  it("folder headers override collection headers with the same name", () => {
    const inner: Folder = {
      id: "fld_j2",
      name: "Inner",
      headers: [{ key: "X-Shared", value: "folder", enabled: true }],
      folders: [],
      requests: [leaf],
      order: [],
    };
    const col: Collection = {
      ...collection,
      headers: [
        { key: "X-Shared", value: "collection", enabled: true },
        { key: "X-Only-Collection", value: "c", enabled: true },
      ],
      folders: [inner],
      requests: [],
    };
    const headers = effectiveHeaders(leaf, col).map((h) => `${h.key}=${h.value}`);
    expect(headers).toContain("X-Shared=folder");
    expect(headers).not.toContain("X-Shared=collection");
    expect(headers).toContain("X-Only-Collection=c");
  });

  it("request headers override collection headers with the same name", () => {
    const col: Collection = {
      ...collection,
      headers: [{ key: "X-Shared", value: "collection", enabled: true }],
      folders: [],
      requests: [{ ...leaf, headers: [{ key: "X-Shared", value: "request", enabled: true }] }],
    };
    const headers = effectiveHeaders(col.requests[0], col).filter((h) =>
      h.key.toLowerCase() === "x-shared",
    );
    expect(headers).toHaveLength(1);
    expect(headers[0].value).toBe("request");
  });

  it("falls back to only the request's own headers without a collection context", () => {
    expect(effectiveHeaders(leaf, undefined)).toEqual([]);
  });
});

describe("effectiveScriptLayers (C10 inherited-scripts viewer)", () => {
  const leaf: Request = {
    id: "req_leaf_c10",
    name: "Leaf",
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "inherit" },
    scripts: { pre: "R", postResponse: "R-post" },
  };
  const inner: Folder = {
    id: "fld_c10_inner",
    name: "Inner",
    scripts: { pre: "INNER" },
    folders: [],
    requests: [leaf],
    order: [],
  };
  const outer: Folder = {
    id: "fld_c10_outer",
    name: "Outer",
    scripts: { test: "OUTER-test" },
    folders: [inner],
    requests: [],
    order: [],
  };
  const col: Collection = {
    ...collection,
    scripts: { pre: "COL", test: "COL-test" },
    folders: [outer],
    requests: [],
  };

  it("labels each layer by origin in execution order", () => {
    const layers = effectiveScriptLayers(leaf, col, "pre");
    expect(layers.map((l) => `${l.source} :: ${l.script}`)).toEqual([
      "collection :: COL",
      "folder · Inner :: INNER",
      "request :: R",
    ]);
    // Test phase: collection + outer folder only (leaf has no test script).
    expect(effectiveScriptLayers(leaf, col, "test").map((l) => l.source)).toEqual([
      "collection",
      "folder · Outer",
    ]);
  });

  it("matches the effective*Scripts output for the same phase", () => {
    for (const phase of ["pre", "postResponse", "test"] as const) {
      const layerScripts = effectiveScriptLayers(leaf, col, phase).map((l) => l.script);
      const expected =
        phase === "pre"
          ? effectivePreScripts(leaf, col)
          : phase === "postResponse"
            ? effectivePostScripts(leaf, col)
            : effectiveTestScripts(leaf, col);
      expect(layerScripts).toEqual(expected);
    }
  });

  it("omits empty layers and returns [] without collection context", () => {
    expect(effectiveScriptLayers(leaf, undefined, "pre")).toEqual([
      { source: "request", script: "R" },
    ]);
    expect(effectiveScriptLayers(leaf, undefined, "test")).toEqual([]);
  });
});

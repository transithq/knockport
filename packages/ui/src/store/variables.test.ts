import type { Collection, Environment } from "@knockport/core";
import { describe, expect, it } from "vitest";
import { buildVariableMap, environmentVariableMap, requestVariableMap } from "./variables";

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

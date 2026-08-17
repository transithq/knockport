import { describe, expect, it } from "vitest";
import type { Environment } from "@knockport/core";
import { SECRET_MASK } from "@knockport/core";
import { deserializeEnvironments, serializeEnvironments } from "./yaml";

function env(id: string, name: string, vars: Environment["variables"]): Environment {
  return { id, name, variables: vars };
}

describe("serializeEnvironments / deserializeEnvironments (H9 bulk export)", () => {
  it("serializes every environment into one document", () => {
    const envs = [
      env("e1", "Prod", [{ key: "host", value: "api.prod.test", enabled: true }]),
      env("e2", "Dev", [{ key: "host", value: "localhost", enabled: true }]),
      env("e3", "Empty", []),
    ];
    const yaml = serializeEnvironments(envs);
    expect(yaml).toContain("environments:");
    expect(yaml).toContain("name: Prod");
    expect(yaml).toContain("name: Dev");
    expect(yaml).toContain("name: Empty");
    expect(yaml).toContain("api.prod.test");
    expect(yaml).toContain("localhost");
  });

  it("round-trips through deserializeEnvironments", () => {
    const envs = [
      env("e1", "Prod", [
        { key: "host", value: "api.prod.test", enabled: true },
        { key: "token", value: "abc", type: "secret", enabled: true },
      ]),
      env("e2", "Dev", []),
    ];
    const back = deserializeEnvironments(serializeEnvironments(envs));
    expect(back).toHaveLength(2);
    expect(back[0].name).toBe("Prod");
    expect(back[0].variables).toHaveLength(2);
    expect(back[1].name).toBe("Dev");
  });

  it("redacts secret values in the bulk export", () => {
    const envs = [env("e1", "Prod", [{ key: "api_key", value: "sk_live_x", type: "secret", enabled: true }])];
    const yaml = serializeEnvironments(envs);
    expect(yaml).toContain(SECRET_MASK);
    expect(yaml).not.toContain("sk_live_x");
    expect(yaml).toContain("type: secret");
  });

  it("rejects a document missing the environments list", () => {
    expect(() => deserializeEnvironments("name: nope\n")).toThrow(/environments/);
  });

  it("serializes an empty set to a valid empty list", () => {
    const yaml = serializeEnvironments([]);
    expect(deserializeEnvironments(yaml)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { Collection, Environment } from "@knockport/core";
import { SECRET_MASK } from "@knockport/core";
import { exportJson, exportPostman } from "./exporters";
import { serializeCollection, serializeEnvironment } from "./yaml";

const env = (): Environment => ({
  id: "e1",
  name: "Prod",
  variables: [
    { key: "host", value: "api.prod.test", enabled: true },
    { key: "api_key", value: "sk_live_topsecret", type: "secret", enabled: true },
    { key: "empty_secret", value: "", type: "secret", enabled: true },
  ],
});

const collection = (): Collection => ({
  id: "c1",
  name: "Secrets",
  variables: [{ key: "password", value: "hunter2", type: "secret", enabled: true }],
  folders: [],
  requests: [],
  order: [],
  metadata: { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
});

describe("export redaction — secrets never leave through downloads", () => {
  it("serializeEnvironment masks secret values", () => {
    const yaml = serializeEnvironment(env());
    expect(yaml).toContain(SECRET_MASK);
    expect(yaml).not.toContain("sk_live_topsecret");
    expect(yaml).toContain("api.prod.test");
    expect(yaml).toContain("type: secret");
  });

  it("serializeCollection masks secret collection variables", () => {
    const yaml = serializeCollection(collection());
    expect(yaml).toContain(SECRET_MASK);
    expect(yaml).not.toContain("hunter2");
  });

  it("exportJson masks secret collection variables", () => {
    const json = exportJson(collection());
    expect(json).toContain(SECRET_MASK);
    expect(json).not.toContain("hunter2");
  });

  it("exportPostman masks secret collection variables", () => {
    const json = exportPostman(collection());
    expect(json).toContain(SECRET_MASK);
    expect(json).not.toContain("hunter2");
    const parsed = JSON.parse(json);
    expect(parsed.variable[0].value).toBe(SECRET_MASK);
  });

  it("empty secret values stay empty (not masked)", () => {
    const yaml = serializeEnvironment(env());
    expect(yaml).toContain("key: empty_secret");
    expect(yaml).toContain(`value: ""`);
    expect(yaml.match(/•/g)?.length).toBe(SECRET_MASK.length);
  });
});

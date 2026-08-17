import { describe, expect, it } from "vitest";
import { importAuto, importPostmanEnvironment } from "./importers";

// Postman exports environments as flat JSON with a `values` array and a
// _postman_variable_scope marker (see H3, B§12 / H§8).
const POSTMAN_ENV_JSON = JSON.stringify({
  id: "abc-123-postman",
  name: "Staging",
  values: [
    { key: "baseUrl", value: "https://staging.example.com", enabled: true, type: "default" },
    { key: "api_token", value: "s3cret-token", enabled: true, type: "secret" },
    { key: "disabled_key", value: "nope", enabled: false, type: "default" },
  ],
  _postman_variable_scope: "environment",
  _postman_exported_at: "2026-01-01T00:00:00.000Z",
  _postman_exported_using: "Postman/11.0.0",
});

// Older/CLI-style export without the scope marker but with a named values array.
const POSTMAN_ENV_NO_MARKER = JSON.stringify({
  id: "def-456",
  name: "Legacy",
  values: [{ key: "k", value: "v", enabled: true }],
});

describe("importPostmanEnvironment", () => {
  it("maps values to KnockPort variables", () => {
    const env = importPostmanEnvironment(POSTMAN_ENV_JSON);
    expect(env.name).toBe("Staging");
    expect(env.id).toMatch(/^env/); // fresh ID, never the Postman one
    expect(env.variables).toEqual([
      { key: "baseUrl", value: "https://staging.example.com", enabled: true },
      { key: "api_token", value: "s3cret-token", enabled: true, type: "secret" },
      { key: "disabled_key", value: "nope", enabled: false },
    ]);
  });

  it("detects exports without the scope marker", () => {
    const env = importPostmanEnvironment(POSTMAN_ENV_NO_MARKER);
    expect(env.name).toBe("Legacy");
    expect(env.variables).toEqual([{ key: "k", value: "v", enabled: true }]);
  });

  it("rejects non-environment documents", () => {
    expect(() => importPostmanEnvironment("{}")).toThrow(/Postman environment/);
  });
});

describe("importAuto environment auto-detect", () => {
  it("routes a Postman environment export to the environment importer", () => {
    const result = importAuto(POSTMAN_ENV_JSON);
    expect(result).toHaveProperty("variables");
    expect(result).not.toHaveProperty("folders");
    expect(result).not.toHaveProperty("method");
    expect((result as { name: string }).name).toBe("Staging");
  });

  it("still routes Postman collections via info.schema", () => {
    const collection = {
      info: { name: "C", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [],
    };
    const result = importAuto(JSON.stringify(collection));
    expect(result).toHaveProperty("folders");
  });
});

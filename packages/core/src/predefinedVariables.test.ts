import { describe, expect, it, vi } from "vitest";
import {
  MAX_DYNAMIC_LENGTH,
  PREDEFINED_VARIABLE_NAMES,
  resolvePredefinedVariables,
} from "./predefinedVariables";
import { resolveVariables } from "./utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("resolvePredefinedVariables", () => {
  it("returns input without {{$ untouched", () => {
    expect(resolvePredefinedVariables("https://{{baseUrl}}/x")).toBe("https://{{baseUrl}}/x");
  });

  it("$guid resolves to a uuid and stays fresh per occurrence", () => {
    const out = resolvePredefinedVariables("{{$guid}}|{{$guid}}");
    const [a, b] = out.split("|");
    expect(a).toMatch(UUID_RE);
    expect(b).toMatch(UUID_RE);
    expect(a).not.toBe(b);
  });

  it("$timestamp and $isoTimestamp resolve", () => {
    const ts = resolvePredefinedVariables("{{$timestamp}}");
    expect(Number(ts)).toBeGreaterThan(1_700_000_000);
    const iso = resolvePredefinedVariables("{{$isoTimestamp}}");
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it("$randomInt resolves to 0–999", () => {
    const n = Number(resolvePredefinedVariables("{{$randomInt}}"));
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1000);
  });

  it("$randomColor is a colour word, $randomHexColor is #rrggbb", () => {
    const word = resolvePredefinedVariables("{{$randomColor}}");
    expect(word).not.toMatch(/^[0-9a-f]+$/i);
    const hex = resolvePredefinedVariables("{{$randomHexColor}}");
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it(":length args are honored and huge values clamped", () => {
    expect(resolvePredefinedVariables("{{$randomString:64}}")).toHaveLength(64);
    expect(resolvePredefinedVariables("{{$randomWords:7}}").split(" ")).toHaveLength(7);
    expect(resolvePredefinedVariables("{{$randomString:9999999999}}")).toHaveLength(
      MAX_DYNAMIC_LENGTH,
    );
  });

  it("misspelled aliases resolve (W2 #199 spellings)", () => {
    expect(resolvePredefinedVariables("{{$randomAlphanumeric:8}}")).toHaveLength(8);
    expect(resolvePredefinedVariables("{{$randomStreet}}")).toMatch(/^\d+ /);
    expect(resolvePredefinedVariables("{{$randomMACAddress}}")).toMatch(
      /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/,
    );
  });

  it("unknown $vars stay literal and warn once per name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolvePredefinedVariables("u={{$randomUserName}}")).toBe("u={{$randomUserName}}");
      resolvePredefinedVariables("u={{$randomUserName}}");
      const hits = warn.mock.calls.filter((c) => String(c[0]).includes("$randomUserName"));
      expect(hits.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("interpolates dynamic vars inside longer strings", () => {
    const out = resolvePredefinedVariables("https://x.test/{{$timestamp}}/{{$randomEmail}}");
    expect(out).not.toContain("{{$");
    expect(out).toMatch(/^https:\/\/x\.test\/\d+\/[^/]+@/);
  });
});

describe("resolveVariables", () => {
  it("resolves $vars first, then the variable map", () => {
    const out = resolveVariables("id={{$guid}} host={{host}}", { host: "api.test" });
    expect(out.endsWith(" host=api.test")).toBe(true);
    expect(out).not.toContain("{{$");
    expect(out.slice(3).split(" ")[0]).toMatch(UUID_RE);
  });

  it("leaves unknown plain variables literal", () => {
    expect(resolveVariables("{{missing}}", {})).toBe("{{missing}}");
  });
});

describe("PREDEFINED_VARIABLE_NAMES", () => {
  it("covers the documented baseline set and every name starts with $", () => {
    for (const name of [
      "$guid",
      "$timestamp",
      "$isoTimestamp",
      "$randomUUID",
      "$randomInt",
      "$randomColor",
    ]) {
      expect(PREDEFINED_VARIABLE_NAMES).toContain(name);
    }
    expect(PREDEFINED_VARIABLE_NAMES.every((n) => n.startsWith("$"))).toBe(true);
  });

  it("every catalog name resolves", () => {
    for (const name of [
      ...PREDEFINED_VARIABLE_NAMES,
      "$randomHex:4",
      "$randomPassword:8",
      "$randomString:4",
    ]) {
      const out = resolvePredefinedVariables(`{{${name}}}`);
      expect(out).not.toContain(`{{${name}}}`);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

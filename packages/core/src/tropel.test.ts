import { createRequire } from "node:module";
import { initCoreWasm } from "@tropel/core-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getPredefinedVariableNames,
  MAX_DYNAMIC_LENGTH,
  resolvePredefinedVariables,
} from "./tropel";
import { resolveVariables } from "./utils";

// Drive the real Tropel catalog: the same wasm bundle apps/web lazy-loads
// at boot (the `@tropel/core-wasm` file: dependency of packages/core).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const facadePath = require.resolve("@tropel/core-wasm");
const wasmPath = join(dirname(facadePath), "..", "pkg", "tropel_core_wasm_bg.wasm");

// Read the pkg into memory up front: with the file: dep hardlinked into the
// pnpm store, the pkg directory can go stale between test runs, while the
// .wasm bytes themselves are immutable.
const wasmBytes = readFileSync(wasmPath);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  const ok = await initCoreWasm({ wasmBytes });
  expect(ok).toBe(true);
});

describe("resolvePredefinedVariables (wasm catalog)", () => {
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
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
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

  it("unknown $vars stay literal", () => {
    expect(resolvePredefinedVariables("u={{$randomUserName}}")).toBe("u={{$randomUserName}}");
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

describe("getPredefinedVariableNames", () => {
  it("covers the documented baseline set and every name starts with $", () => {
    const names = getPredefinedVariableNames();
    for (const name of [
      "$guid",
      "$timestamp",
      "$isoTimestamp",
      "$randomUUID",
      "$randomInt",
      "$randomColor",
    ]) {
      expect(names).toContain(name);
    }
    expect(names.every((n) => n.startsWith("$"))).toBe(true);
  });

  it("every catalog name resolves", () => {
    for (const name of [
      ...getPredefinedVariableNames(),
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

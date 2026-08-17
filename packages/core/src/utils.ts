import type { BodyContent, KeyValuePair, Request, Variable } from "./types.js";
import { resolvePredefinedVariables } from "./tropel.js";

/**
 * Generate a short, collision-resistant ID.
 * Uses crypto.randomUUID when available, falls back to a timestamp-based scheme.
 */
export function createId(prefix = ""): string {
  const base =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}_${base}` : base;
}

/**
 * Deep-clone a plain object. Structured-clone where available, JSON round-trip otherwise.
 */
export function deepClone<T>(obj: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Stable sort key-value pairs: enabled items first, then alphabetical by key.
 */
export function stableSortPairs<T extends { key: string; enabled: boolean }>(pairs: T[]): T[] {
  return [...pairs].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Resolve `{{variable}}` references in a string against a variable map.
 * Predefined dynamic `$variables` ({{$guid}}, {{$timestamp}}, …) are resolved
 * first, each occurrence generating a fresh value.
 */
export function resolveVariables(
  template: string,
  variables: Record<string, string>,
): string {
  const dynamic = resolvePredefinedVariables(template);
  return dynamic.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const trimmed = key.trim();
    return variables[trimmed] ?? `{{${trimmed}}}`;
  });
}

// ── Secret variables ─────────────────────────────────────────────────────────
// `Variable.type === "secret"` marks credentials. Values stay live in memory
// and in Dexie (IndexedDB is local user storage), and in on-disk collection
// folders (the user's working files — reloading them must not empty secrets).
// Everywhere else — exports, codegen downloads, history records — values are
// masked. Same split as Postman/Bruno/Hoppscotch.

/** Placeholder shown in place of a secret value. */
export const SECRET_MASK = "••••••••";

export function isSecretVariable(v: Variable): boolean {
  return v.type === "secret";
}

/** Copy of the list with every non-empty secret value masked (export/download paths). */
export function redactVariables(vars: Variable[]): Variable[] {
  return vars.map((v) =>
    isSecretVariable(v) && v.value ? { ...v, value: SECRET_MASK } : v,
  );
}

/** Resolved values of enabled secret variables, for scrubbing after interpolation. */
export function secretVariableValues(...sources: Variable[][]): string[] {
  const values = new Set<string>();
  for (const vars of sources) {
    for (const v of vars) {
      if (isSecretVariable(v) && v.enabled !== false && v.value) values.add(v.value);
    }
  }
  return [...values];
}

/**
 * Replace occurrences of secret values anywhere they leaked into a resolved
 * request (injected auth headers, query placement, body) with the mask.
 * Used before a request is persisted (history) so credentials never reach
 * IndexedDB.
 */
export function scrubRequestSecrets(request: Request, secretValues: string[]): Request {
  if (secretValues.length === 0) return request;
  const mask = (s: string) =>
    secretValues.reduce((acc, v) => (v && acc.includes(v) ? acc.split(v).join(SECRET_MASK) : acc), s);

  const scrubPairs = (pairs: KeyValuePair[]): KeyValuePair[] =>
    pairs.map((p) => ({ ...p, value: mask(p.value) }));
  const scrubBody = (body: BodyContent): BodyContent => {
    if ("content" in body && typeof body.content === "string") {
      return { ...body, content: mask(body.content) };
    }
    return body;
  };

  return {
    ...request,
    url: mask(request.url),
    headers: scrubPairs(request.headers),
    params: scrubPairs(request.params),
    body: scrubBody(request.body),
  };
}

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
 * Pass order: predefined dynamic `$variables` ({{$guid}}, …, fresh per
 * occurrence) → prompt variables `{{$prompt.name}}` (answered on send) →
 * plain `{{name}}` lookups.
 */
export function resolveVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let out = resolvePredefinedVariables(template);
  out = out.replace(PROMPT_VAR_RE, (_, name: string) => {
    return variables[`prompt.${name}`] ?? `{{$prompt.${name}}}`;
  });
  return out.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const trimmed = key.trim();
    return variables[trimmed] ?? `{{${trimmed}}}`;
  });
}

// ── Prompt variables ─────────────────────────────────────────────────────────
// `{{$prompt.name}}` placeholders ask for a value in a pre-send dialog
// (Bruno's PromptVariablesModal). The map key is `prompt.name`; values are
// merged into the variable map before pre-request scripts run.

const PROMPT_VAR_RE = /\{\{\s*\$prompt\.([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Distinct prompt-variable names referenced across the given texts (URL,
 * params, headers, body, scripts), in first-occurrence order.
 */
export function collectPromptVariableNames(...texts: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(PROMPT_VAR_RE)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        names.push(m[1]);
      }
    }
  }
  return names;
}

/** Prompt-variable names referenced anywhere in a raw (unresolved) request. */
export function collectRequestPromptVariables(request: Request): string[] {
  const texts: string[] = [request.url];
  for (const p of request.params ?? []) texts.push(p.key, p.value);
  for (const h of request.headers ?? []) texts.push(h.key, h.value);
  const body = request.body;
  if (body?.content) texts.push(body.content);
  if (body?.graphql) texts.push(body.graphql.query, body.graphql.variables ?? "");
  for (const f of body?.formData ?? []) {
    if (typeof f.value === "string") texts.push(f.key, f.value);
  }
  if (request.scripts) {
    texts.push(request.scripts.pre ?? "", request.scripts.test ?? "", request.scripts.postResponse ?? "");
  }
  return collectPromptVariableNames(...texts);
}

/**
 * Merge prompt answers into a variable map under `prompt.*` keys so
 * `{{$prompt.name}}` placeholders resolve through the standard path.
 */
export function withPromptAnswers(
  vars: Record<string, string>,
  answers: Record<string, string>,
): Record<string, string> {
  const out = { ...vars };
  for (const [name, value] of Object.entries(answers)) out[`prompt.${name}`] = value;
  return out;
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
    // File handles can't survive persistence/JSON — reduce to filename markers
    // so history stays serializable (E1).
    if (body.type === "binary" && body.file) {
      return { ...body, file: undefined, content: `[file: ${body.file.name}]` };
    }
    if (body.formData) {
      return {
        ...body,
        formData: body.formData.map((f) =>
          f.value instanceof File ? { ...f, value: f.value.name } : f,
        ),
      };
    }
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

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
 */
export function resolveVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const trimmed = key.trim();
    return variables[trimmed] ?? `{{${trimmed}}}`;
  });
}

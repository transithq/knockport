import type { Request, KeyValuePair, AuthConfig, BodyContent, Collection, Folder } from "@knockport/core";
import { resolveVariables } from "@knockport/core";
import type { AppStore } from "./app-store";

// ── Variable resolution ──────────────────────────────────────────────────────
// Precedence (low → high): collection variables, then environment variables.
// Environment values override collection values for the same key.

export function buildVariableMap(state: Pick<AppStore, "collections" | "environments" | "activeEnvironmentId">): Record<string, string> {
  const map: Record<string, string> = {};

  // Collection variables (lowest precedence)
  for (const collection of state.collections) {
    for (const v of collection.variables ?? []) {
      if (v.enabled) map[v.key] = v.value;
    }
  }

  // Environment variables (override collection)
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
  if (env) {
    for (const v of env.variables ?? []) {
      if (v.enabled) map[v.key] = v.value;
    }
  }

  return map;
}

/** Variables of the active environment only (pm.environment.* scope). */
export function environmentVariableMap(state: Pick<AppStore, "environments" | "activeEnvironmentId">): Record<string, string> {
  const map: Record<string, string> = {};
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
  if (env) {
    for (const v of env.variables ?? []) {
      if (v.enabled) map[v.key] = v.value;
    }
  }
  return map;
}

/** Collection variables merged across all collections (pm.collectionVariables.* scope). */
export function collectionVariablesMap(state: Pick<AppStore, "collections">): Record<string, string> {
  const map: Record<string, string> = {};
  for (const collection of state.collections) {
    for (const v of collection.variables ?? []) {
      if (v.enabled) map[v.key] = v.value;
    }
  }
  return map;
}

function resolvePairs(pairs: KeyValuePair[], vars: Record<string, string>): KeyValuePair[] {
  return pairs.map((p) => ({
    ...p,
    key: resolveVariables(p.key, vars),
    value: resolveVariables(p.value, vars),
  }));
}

function resolveBody(body: BodyContent, vars: Record<string, string>): BodyContent {
  if ("content" in body && typeof body.content === "string") {
    return { ...body, content: resolveVariables(body.content, vars) };
  }
  return body;
}

function resolveAuth(auth: AuthConfig, vars: Record<string, string>): AuthConfig {
  switch (auth.type) {
    case "bearer":
      return { ...auth, bearer: { token: resolveVariables(auth.bearer?.token ?? "", vars) } };
    case "basic":
      return {
        ...auth,
        basic: {
          username: resolveVariables(auth.basic?.username ?? "", vars),
          password: resolveVariables(auth.basic?.password ?? "", vars),
        },
      };
    case "apiKey":
      return {
        ...auth,
        apiKey: auth.apiKey
          ? { ...auth.apiKey, value: resolveVariables(auth.apiKey.value, vars) }
          : undefined,
      };
    default:
      return auth;
  }
}

/** Return a fully-resolved copy of the request for execution. */
export function resolveRequest(request: Request, vars: Record<string, string>, collection?: Collection): Request {
  const auth = resolveAuth(effectiveAuth(request, collection), vars);
  let headers = resolvePairs(request.headers, vars);
  let params = resolvePairs(request.params, vars);

  // Inject credentials so transports/codegen see a self-contained request.
  if (auth.type === "bearer" && auth.bearer?.token) {
    headers = withHeader(headers, "Authorization", `Bearer ${auth.bearer.token}`);
  } else if (auth.type === "basic" && auth.basic) {
    headers = withHeader(headers, "Authorization", `Basic ${btoa(`${auth.basic.username}:${auth.basic.password}`)}`);
  } else if (auth.type === "apiKey" && auth.apiKey) {
    if (auth.apiKey.in === "query") {
      params = [
        ...params.filter((p) => p.key !== auth.apiKey?.key),
        { key: auth.apiKey.key, value: auth.apiKey.value, enabled: true },
      ];
    } else {
      headers = withHeader(headers, auth.apiKey.key, auth.apiKey.value);
    }
  }

  return {
    ...request,
    url: resolveVariables(request.url, vars),
    headers,
    params,
    body: resolveBody(request.body, vars),
    auth,
  };
}

// ── Collection inheritance ───────────────────────────────────────────────────

/** The collection a request belongs to (walks nested folders). */
export function findCollectionOfRequest(collections: Collection[], requestId: string): Collection | undefined {
  const inFolder = (f: Folder): boolean => f.requests.some((r) => r.id === requestId) || f.folders.some(inFolder);
  return collections.find((c) => c.requests.some((r) => r.id === requestId) || c.folders.some(inFolder));
}

/** Resolve `inherit` auth against the parent collection. */
export function effectiveAuth(request: Request, collection?: Collection): AuthConfig {
  const own = request.auth ?? { type: "inherit" };
  if (own.type !== "inherit") return own;
  const col = collection?.auth;
  return col && col.type !== "inherit" ? col : { type: "none" };
}

/** Replace (or append) a header by name, case-insensitively. */
function withHeader(headers: KeyValuePair[], key: string, value: string): KeyValuePair[] {
  return [...headers.filter((h) => h.key.toLowerCase() !== key.toLowerCase()), { key, value, enabled: true }];
}

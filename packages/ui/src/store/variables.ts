import type { Request, KeyValuePair, AuthConfig, BodyContent } from "@knockport/core";
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
export function resolveRequest(request: Request, vars: Record<string, string>): Request {
  return {
    ...request,
    url: resolveVariables(request.url, vars),
    headers: resolvePairs(request.headers, vars),
    params: resolvePairs(request.params, vars),
    body: resolveBody(request.body, vars),
    auth: resolveAuth(request.auth, vars),
  };
}

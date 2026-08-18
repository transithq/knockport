import type {
  Request,
  RequestVariable,
  KeyValuePair,
  AuthConfig,
  BodyContent,
  Collection,
  Folder,
  Environment,
} from "@knockport/core";
import { resolveVariables } from "@knockport/core";
import type { AppStore } from "./app-store";

// ── Variable resolution ──────────────────────────────────────────────────────
// Precedence (low → high, Bruno merge order): global environment (the
// environment marked isDefault) → collection variables → environment layer
// (active or runner-picked) → folder variables (A2) → request variables
// (A1). Runtime/prompt layers are merged by the callers on top of the map.

/** The environment acting as the global scope (isDefault flag). */
export function getGlobalsEnvironment(
  state: Pick<AppStore, "environments">,
): import("@knockport/core").Environment | undefined {
  return state.environments.find((e) => e.isDefault);
}

/**
 * Runner environment override (D3): a collection run can execute against a
 * picked environment instead of the workspace's active one. When
 * `includeActiveEnv` is set, the active environment's variables are merged in
 * below the picked one (active env values win nothing — runner env overrides).
 */
export interface RunnerEnvOverride {
  /** Environment picked in the runner (undefined = use the active env as usual). */
  runnerEnv?: Environment;
  /** When a runner env is picked, also merge the active env underneath it. */
  includeActiveEnv?: boolean;
}

/**
 * Extra per-execution layers applied on top of the environment layer
 * (A1 request variables). Folder variables (A2) slot in between the
 * collection variables and the request variables.
 */
export interface ExecutionVarLayers {
  /** Folder-inherited variables: collection vars < folder vars < request vars. */
  folderVars?: RequestVariable[];
  /** Request-scoped variables: override every other data/env layer. */
  requestVars?: RequestVariable[];
}

function applyEnvLayer(map: Record<string, string>, env: Environment | undefined): void {
  if (!env) return;
  for (const v of env.variables ?? []) {
    if (v.enabled) map[v.key] = v.value;
  }
}

function applyVarList(
  map: Record<string, string>,
  vars: import("@knockport/core").RequestVariable[] | undefined,
): void {
  for (const v of vars ?? []) {
    if (v.enabled !== false && v.key) map[v.key] = v.value;
  }
}

/** Enabled request-scoped (req) variables as a plain map (A1). */
export function requestVariableMap(vars: RequestVariable[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  applyVarList(map, vars);
  return map;
}

export function buildVariableMap(
  state: Pick<AppStore, "collections" | "environments" | "activeEnvironmentId">,
  runnerOverride?: RunnerEnvOverride,
  layers?: ExecutionVarLayers,
): Record<string, string> {
  const map: Record<string, string> = {};

  // Global environment variables (lowest precedence)
  applyEnvLayer(map, getGlobalsEnvironment(state));

  // Collection variables (override globals)
  for (const collection of state.collections) {
    for (const v of collection.variables ?? []) {
      if (v.enabled) map[v.key] = v.value;
    }
  }

  // Environment layer(s): runner-picked env overrides the active one (or
  // merges over it when includeActiveEnv is set).
  const active = state.environments.find((e) => e.id === state.activeEnvironmentId);
  if (runnerOverride?.runnerEnv) {
    if (runnerOverride.includeActiveEnv) applyEnvLayer(map, active);
    applyEnvLayer(map, runnerOverride.runnerEnv);
  } else {
    applyEnvLayer(map, active);
  }

  // Folder-inherited variables (A2): override collection/env layers.
  applyVarList(map, layers?.folderVars);

  // Request-scoped variables (A1): highest data-layer precedence.
  applyVarList(map, layers?.requestVars);

  return map;
}

/** Variables of the active (or runner-picked) environment only (pm.environment.* scope). */
export function environmentVariableMap(
  state: Pick<AppStore, "environments" | "activeEnvironmentId">,
  runnerOverride?: RunnerEnvOverride,
): Record<string, string> {
  const map: Record<string, string> = {};
  const active = state.environments.find((e) => e.id === state.activeEnvironmentId);
  if (runnerOverride?.runnerEnv) {
    if (runnerOverride.includeActiveEnv) applyEnvLayer(map, active);
    applyEnvLayer(map, runnerOverride.runnerEnv);
  } else {
    applyEnvLayer(map, active);
  }
  return map;
}

/** Global environment variables (pm.globals.* scope). */
export function globalsVariableMap(state: Pick<AppStore, "environments">): Record<string, string> {
  const map: Record<string, string> = {};
  const globals = getGlobalsEnvironment(state);
  if (globals) {
    for (const v of globals.variables ?? []) {
      if (v.enabled) map[v.key] = v.value;
    }
  }
  return map;
}

/**
 * Name of the executing environment (C9 `bru.getEnvName()`). The runner
 * override wins over the workspace's active environment.
 */
export function environmentName(
  state: Pick<AppStore, "environments" | "activeEnvironmentId">,
  runnerOverride?: RunnerEnvOverride,
): string | undefined {
  const env =
    runnerOverride?.runnerEnv ??
    state.environments.find((e) => e.id === state.activeEnvironmentId);
  return env?.name;
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
    case "oauth2": {
      const o2 = auth.oauth2;
      if (!o2) return auth;
      const opt = (v?: string) => (v === undefined ? undefined : resolveVariables(v, vars));
      return {
        ...auth,
        oauth2: {
          ...o2,
          clientId: opt(o2.clientId),
          clientSecret: opt(o2.clientSecret),
          authUrl: opt(o2.authUrl),
          tokenUrl: opt(o2.tokenUrl),
          redirectUri: opt(o2.redirectUri),
          username: opt(o2.username),
          password: opt(o2.password),
          headerPrefix: opt(o2.headerPrefix),
          queryParamName: opt(o2.queryParamName),
        },
      };
    }
    default:
      return auth;
  }
}

/** Return a fully-resolved copy of the request for execution. */
export function resolveRequest(request: Request, vars: Record<string, string>, collection?: Collection): Request {
  const auth = resolveAuth(effectiveAuth(request, collection), vars);
  // Inherited headers (J1) are merged here so transports/codegen/runner
  // results all see the final set; request entries win on duplicate names
  // (enabled-flag filtering stays with the transports).
  let headers = resolvePairs(
    collection ? effectiveHeaders(request, collection) : request.headers,
    vars,
  );
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

/**
 * The folder chain from the collection root down to (and including) the
 * folder that directly contains the request. Root first. Empty when the
 * request sits at the collection root.
 */
export function findFolderPath(collection: Collection, requestId: string): Folder[] | undefined {
  // A request living directly on the collection root has no folder chain.
  if (collection.requests.some((r) => r.id === requestId)) return [];
  const inFolder = (folders: Folder[], chain: Folder[]): Folder[] | undefined => {
    for (const f of folders) {
      if (f.requests.some((r) => r.id === requestId)) return [...chain, f];
      const deeper = inFolder(f.folders, [...chain, f]);
      if (deeper) return deeper;
    }
    return undefined;
  };
  return inFolder(collection.folders, []);
}

/**
 * Folder-inherited variables (A2) for a request: every folder in the chain
 * from root to the parent folder, merged in order — deeper folders override
 * their ancestors for the same key. These sit above the collection/env layers
 * in {@link buildVariableMap} and below request variables.
 */
export function folderVariablesFor(collection: Collection, requestId: string): RequestVariable[] {
  const chain = findFolderPath(collection, requestId);
  if (!chain?.length) return [];
  const map = new Map<string, RequestVariable>();
  for (const folder of chain) {
    for (const v of folder.variables ?? []) {
      if (v.key) map.set(v.key, v);
    }
  }
  return [...map.values()];
}

/**
 * Inherited headers (J1/J2): collection headers first, then every folder's
 * headers root→parent, then the request's own headers — later layers
 * (collection < folder < request) win on duplicate names,
 * case-insensitively.
 */
export function effectiveHeaders(request: Request, collection?: Collection): KeyValuePair[] {
  const layers: KeyValuePair[][] = [];
  if (collection) {
    layers.push(collection.headers ?? []);
    for (const f of findFolderPath(collection, request.id) ?? []) {
      layers.push(f.headers ?? []);
    }
  }
  layers.push(request.headers);
  const merged: KeyValuePair[] = [];
  for (const layer of layers) {
    for (const h of layer) {
      const i = merged.findIndex((m) => m.key.toLowerCase() === h.key.toLowerCase());
      if (i >= 0) merged[i] = h;
      else merged.push(h);
    }
  }
  return merged;
}

/**
 * Pre-request scripts (J1) in execution order: collection, then each folder in
 * the chain (root→parent), then the request's own script.
 */
export function effectivePreScripts(request: Request, collection?: Collection): string[] {
  const scripts: string[] = [];
  if (collection?.scripts?.pre?.trim()) scripts.push(collection.scripts.pre);
  if (collection) {
    for (const f of findFolderPath(collection, request.id) ?? []) {
      if (f.scripts?.pre?.trim()) scripts.push(f.scripts.pre);
    }
  }
  if (request.scripts?.pre?.trim()) scripts.push(request.scripts.pre);
  return scripts;
}

/**
 * Post-response scripts (J1) in execution order: collection, then each folder
 * in the chain (root→parent), then the request's own script.
 */
export function effectivePostScripts(request: Request, collection?: Collection): string[] {
  const scripts: string[] = [];
  if (collection?.scripts?.postResponse?.trim()) scripts.push(collection.scripts.postResponse);
  if (collection) {
    for (const f of findFolderPath(collection, request.id) ?? []) {
      if (f.scripts?.postResponse?.trim()) scripts.push(f.scripts.postResponse);
    }
  }
  if (request.scripts?.postResponse?.trim()) scripts.push(request.scripts.postResponse);
  return scripts;
}

/**
 * Test scripts (J1) in execution order: collection, then each folder in the
 * chain (root→parent), then the request's own script.
 */
export function effectiveTestScripts(request: Request, collection?: Collection): string[] {
  const scripts: string[] = [];
  if (collection?.scripts?.test?.trim()) scripts.push(collection.scripts.test);
  if (collection) {
    for (const f of findFolderPath(collection, request.id) ?? []) {
      if (f.scripts?.test?.trim()) scripts.push(f.scripts.test);
    }
  }
  if (request.scripts?.test?.trim()) scripts.push(request.scripts.test);
  return scripts;
}

/** Assertions (J1) in execution order: collection, then folder chain, then request. */
export function effectiveAssertions(
  request: Request,
  collection?: Collection,
): import("@knockport/core").Assertion[] {
  const out: import("@knockport/core").Assertion[] = [...(collection?.assertions ?? [])];
  if (collection) {
    for (const f of findFolderPath(collection, request.id) ?? []) {
      out.push(...(f.assertions ?? []));
    }
  }
  out.push(...(request.assertions ?? []));
  return out;
}

/** Resolve `inherit` auth against the nearest folder ancestor, then the collection. */
export function effectiveAuth(request: Request, collection?: Collection): AuthConfig {
  const own = request.auth ?? { type: "inherit" };
  if (own.type !== "inherit") return own;
  if (collection) {
    for (const f of [...findFolderPath(collection, request.id) ?? []].reverse()) {
      if (f.auth && f.auth.type !== "inherit" && f.auth.type !== "none") return f.auth;
    }
  }
  const col = collection?.auth;
  return col && col.type !== "inherit" ? col : { type: "none" };
}

/** Replace (or append) a header by name, case-insensitively. */
function withHeader(headers: KeyValuePair[], key: string, value: string): KeyValuePair[] {
  return [...headers.filter((h) => h.key.toLowerCase() !== key.toLowerCase()), { key, value, enabled: true }];
}

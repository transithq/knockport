import type {
  AuthConfig,
  BodyContent,
  Collection,
  Environment,
  Folder,
  HttpMethod,
  KeyValuePair,
  Request,
  Variable,
} from "@knockport/core";
import { createId, redactVariables } from "@knockport/core";
import { type DocumentOptions, type ToStringOptions, parse, stringify } from "yaml";

// ── Byte-stable YAML serialization ───────────────────────────────────────────
// Three rules that make or break the git story:
// 1. Byte-stable serialization — stable key order, LF, no trailing whitespace
// 2. Ordering lives in folder.yaml as an order: [...] list
// 3. Secrets are references, never values

const DOC_OPTS: DocumentOptions = {};
const STR_OPTS: ToStringOptions = {
  lineWidth: 0,
  minContentWidth: 0,
  singleQuote: false,
};

/**
 * Serialize a collection to byte-stable YAML (download/export artifact —
 * secret variable values are masked; on-disk collections go through
 * files.ts, which keeps live values in the user's own working files).
 * - Stable key order via sorted serialization
 * - LF line endings
 * - No trailing whitespace
 * - No regenerated IDs
 */
export function serializeCollection(collection: Collection): string {
  const doc = collectionToYamlDoc({
    ...collection,
    variables: redactVariables(collection.variables ?? []),
  });
  const raw = stringify(doc, STR_OPTS);
  return normalizeOutput(raw);
}

/**
 * Deserialize a collection from YAML.
 */
export function deserializeCollection(yaml: string): Collection {
  const doc = parse(yaml, DOC_OPTS) as RawCollection;
  return collectionFromRaw(doc);
}

/**
 * Serialize an environment to byte-stable YAML (download/export artifact —
 * secret variable values are masked; live values persist via Dexie and the
 * environments/ disk layout in files.ts).
 */
export function serializeEnvironment(env: Environment): string {
  const doc = {
    name: env.name,
    variables: redactVariables(env.variables ?? []).map(serializeVariable),
  };
  const raw = stringify(doc, STR_OPTS);
  return normalizeOutput(raw);
}

/**
 * Deserialize an environment from YAML.
 */
export function deserializeEnvironment(yaml: string): Environment {
  const doc = parse(yaml, DOC_OPTS) as any;
  return environmentFromRaw(doc);
}

/**
 * Serialize every environment into a single bulk YAML document (H9,
 * download/export artifact — secret variable values are masked, matching
 * `serializeEnvironment`). Round-trips through `deserializeEnvironments`.
 */
export function serializeEnvironments(envs: Environment[]): string {
  const doc = {
    environments: envs.map((env) => ({
      name: env.name,
      variables: redactVariables(env.variables ?? []).map(serializeVariable),
    })),
  };
  const raw = stringify(doc, STR_OPTS);
  return normalizeOutput(raw);
}

/**
 * Deserialize the bulk environment document produced by
 * `serializeEnvironments`.
 */
export function deserializeEnvironments(yaml: string): Environment[] {
  const doc = parse(yaml, DOC_OPTS) as any;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.environments)) {
    throw new Error("Invalid bulk environment document — expected an environments: list");
  }
  return doc.environments.map((e: any) => environmentFromRaw(e ?? {}));
}

/**
 * Serialize a single request to byte-stable YAML.
 */
export function serializeRequest(request: Request): string {
  const doc = requestToYamlDoc(request);
  const raw = stringify(doc, STR_OPTS);
  return normalizeOutput(raw);
}

/**
 * Deserialize a single request from YAML.
 */
export function deserializeRequest(yaml: string): Request {
  const doc = parse(yaml, DOC_OPTS) as any;
  return requestFromRaw(doc);
}

/** Build a Collection from an already-parsed document (JSON or YAML). */
export function collectionFromRaw(raw: RawCollection): Collection {
  return rawToCollection(raw);
}

/** Build a Request from an already-parsed document (JSON or YAML). */
export function requestFromRaw(raw: any): Request {
  return rawToRequest(raw);
}

/** Build an Environment from an already-parsed document (JSON or YAML). */
export function environmentFromRaw(doc: any): Environment {
  return {
    id: doc.id ?? "",
    name: doc.name ?? "Imported Environment",
    variables: (doc.variables ?? []).map(deserializeVariable),
    isDefault: doc.isDefault,
  };
}

/**
 * Regenerate every ID in a collection and remap the order lists.
 * Native exports carry the original IDs; reusing them would overwrite the
 * original records on import (Dexie put by primary key). Order entries
 * referencing known IDs are remapped; anything unresolvable is dropped and
 * missing children are re-appended in document order.
 */
export function assignCollectionIds(collection: Collection): Collection {
  const idMap = new Map<string, string>();

  const remapOrder = (order: string[], folders: Folder[], requests: Request[]): string[] => {
    const known = new Set<string>([...folders.map((f) => f.id), ...requests.map((r) => r.id)]);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const old of order) {
      const nid = idMap.get(old);
      if (nid && known.has(nid) && !seen.has(nid)) {
        out.push(nid);
        seen.add(nid);
      }
    }
    for (const f of folders) {
      if (!seen.has(f.id)) {
        out.push(f.id);
        seen.add(f.id);
      }
    }
    for (const r of requests) {
      if (!seen.has(r.id)) {
        out.push(r.id);
        seen.add(r.id);
      }
    }
    return out;
  };

  const assignRequest = (r: Request): Request => {
    const fresh = createId("req");
    if (r.id) idMap.set(r.id, fresh);
    return { ...r, id: fresh };
  };

  const assignFolder = (f: Folder): Folder => {
    const folders = f.folders.map(assignFolder);
    const requests = f.requests.map(assignRequest);
    const fresh = createId("fld");
    if (f.id) idMap.set(f.id, fresh);
    return { ...f, id: fresh, folders, requests, order: remapOrder(f.order, folders, requests) };
  };

  const folders = collection.folders.map(assignFolder);
  const requests = collection.requests.map(assignRequest);
  return {
    ...collection,
    id: createId("col"),
    folders,
    requests,
    order: remapOrder(collection.order, folders, requests),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function normalizeOutput(raw: string): string {
  // LF only, no trailing whitespace on any line, single trailing newline
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n+$/, "\n");
}

function collectionToYamlDoc(c: Collection): Record<string, any> {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    auth: c.auth?.type !== "none" ? serializeAuth(c.auth) : undefined,
    scripts: c.scripts
      ? { pre: c.scripts.pre, test: c.scripts.test, postResponse: c.scripts.postResponse }
      : undefined,
    variables: c.variables.map(serializeVariable),
    order: c.order,
    folders: c.folders.map(folderToYamlDoc),
    requests: c.requests.map(requestToYamlDoc),
  };
}

function folderToYamlDoc(f: Folder): Record<string, any> {
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    auth: f.auth?.type !== "none" ? serializeAuth(f.auth) : undefined,
    scripts: f.scripts
      ? { pre: f.scripts.pre, test: f.scripts.test, postResponse: f.scripts.postResponse }
      : undefined,
    variables: f.variables?.length ? f.variables : undefined,
    order: f.order,
    folders: f.folders.map(folderToYamlDoc),
    requests: f.requests.map(requestToYamlDoc),
  };
}

function requestToYamlDoc(r: Request): Record<string, any> {
  return {
    id: r.id,
    name: r.name,
    method: r.method,
    url: r.url,
    headers: serializePairs(r.headers),
    params: serializePairs(r.params),
    body: serializeBody(r.body),
    auth: r.auth?.type !== "inherit" ? serializeAuth(r.auth) : undefined,
    requestVars: r.requestVars?.length ? r.requestVars : undefined,
    responseVars: r.responseVars?.length ? r.responseVars : undefined,
    scripts: r.scripts
      ? { pre: r.scripts.pre, test: r.scripts.test, postResponse: r.scripts.postResponse }
      : undefined,
    assertions: r.assertions?.length ? r.assertions : undefined,
    load: r.load
      ? { vus: r.load.vus, duration: r.load.duration, thresholds: r.load.thresholds }
      : undefined,
  };
}

function serializePairs(pairs: KeyValuePair[]): Record<string, any>[] | undefined {
  if (!pairs.length) return undefined;
  return pairs.map((p) => ({
    key: p.key,
    value: p.value,
    enabled: p.enabled,
    description: p.description,
  }));
}

function serializeBody(body: BodyContent): Record<string, any> | undefined {
  if (body.type === "none") return undefined;
  return {
    type: body.type,
    content: body.content,
    formData: body.formData?.map((f) => ({
      key: f.key,
      value: typeof f.value === "string" ? f.value : "[file]",
      type: f.type,
      enabled: f.enabled,
    })),
    graphql: body.graphql,
  };
}

function serializeAuth(auth?: AuthConfig): Record<string, any> | undefined {
  if (!auth || auth.type === "none" || auth.type === "inherit") return undefined;
  const details = (auth as unknown as Record<string, unknown>)[auth.type];
  return {
    type: auth.type,
    ...(details && typeof details === "object" ? details : {}),
  };
}

function serializeVariable(v: Variable): Record<string, any> {
  return {
    key: v.key,
    value: v.value,
    type: v.type,
    scope: v.scope,
    enabled: v.enabled,
  };
}

// ── Deserialization helpers ──────────────────────────────────────────────────

interface RawCollection {
  id?: string;
  name: string;
  description?: string;
  auth?: any;
  scripts?: { pre?: string; test?: string; postResponse?: string };
  variables?: any[];
  order?: string[];
  folders?: any[];
  requests?: any[];
}

function rawToCollection(raw: RawCollection): Collection {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "Imported Collection",
    description: raw.description,
    auth: raw.auth ? deserializeAuth(raw.auth) : undefined,
    scripts: raw.scripts,
    variables: (raw.variables ?? []).map(deserializeVariable),
    folders: (raw.folders ?? []).map(rawToFolder),
    requests: (raw.requests ?? []).map(rawToRequest),
    order: raw.order ?? [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function rawToFolder(raw: any): Folder {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "Folder",
    description: raw.description,
    auth: raw.auth ? deserializeAuth(raw.auth) : undefined,
    scripts: raw.scripts,
    variables: (raw.variables ?? []).map(deserializeVarPair),
    folders: (raw.folders ?? []).map(rawToFolder),
    requests: (raw.requests ?? []).map(rawToRequest),
    order: raw.order ?? [],
  };
}

function rawToRequest(raw: any): Request {
  const body = raw.body;
  return {
    id: raw.id ?? "",
    name: raw.name ?? "Request",
    method: (raw.method ?? "GET") as HttpMethod,
    url: raw.url ?? "",
    headers: (raw.headers ?? []).map(deserializePair),
    params: (raw.params ?? []).map(deserializePair),
    body:
      body && typeof body === "object"
        ? {
            type: body.type ?? "none",
            content: body.content,
            formData: body.formData,
            graphql: body.graphql,
          }
        : body && typeof body === "string"
          ? { type: "text", content: body }
          : { type: "none" },
    auth: raw.auth ? deserializeAuth(raw.auth) : { type: "inherit" },
    requestVars: (raw.requestVars ?? []).map(deserializeVarPair),
    responseVars: (raw.responseVars ?? []).map(deserializeVarPair),
    scripts: raw.scripts,
    assertions: raw.assertions,
    load: raw.load,
  };
}

/** Request/response variable round-trip (A1): key + value expression, enabled. */
function deserializeVarPair(raw: any): { key: string; value: string; enabled?: boolean } {
  return {
    key: raw.key ?? "",
    value: raw.value ?? "",
    ...(raw.enabled === false ? { enabled: false } : {}),
  };
}

function deserializePair(raw: any): KeyValuePair {
  return {
    key: raw.key ?? "",
    value: raw.value ?? "",
    description: raw.description,
    enabled: raw.enabled !== false,
  };
}

/**
 * Rebuild a nested AuthConfig from a serialized auth block. Accepts both the
 * flat YAML shape ({type, token}) and the nested native-JSON shape
 * ({type, bearer: {token}}).
 */
function deserializeAuth(raw: any): AuthConfig {
  const type = raw?.type ?? "none";
  switch (type) {
    case "bearer":
      return { type, bearer: { token: raw.bearer?.token ?? raw.token ?? "" } };
    case "basic":
      return {
        type,
        basic: {
          username: raw.basic?.username ?? raw.username ?? "",
          password: raw.basic?.password ?? raw.password ?? "",
        },
      };
    case "apiKey":
      return {
        type,
        apiKey: {
          key: raw.apiKey?.key ?? raw.key ?? "",
          value: raw.apiKey?.value ?? raw.value ?? "",
          in: (raw.apiKey?.in ?? raw.in) === "query" ? "query" : "header",
        },
      };
    case "digest":
      return {
        type,
        digest: {
          username: raw.digest?.username ?? raw.username ?? "",
          password: raw.digest?.password ?? raw.password ?? "",
        },
      };
    case "oauth1":
      return {
        type,
        oauth1: {
          consumerKey: raw.oauth1?.consumerKey ?? raw.consumerKey ?? "",
          consumerSecret: raw.oauth1?.consumerSecret ?? raw.consumerSecret ?? "",
          token: raw.oauth1?.token ?? raw.token ?? "",
          tokenSecret: raw.oauth1?.tokenSecret ?? raw.tokenSecret ?? "",
          signatureMethod: raw.oauth1?.signatureMethod ?? raw.signatureMethod ?? "HMAC-SHA1",
        },
      };
    case "oauth2": {
      const src = raw.oauth2 ?? raw;
      return {
        type,
        oauth2: {
          grantType: src.grantType ?? "authorization_code",
          accessToken: src.accessToken,
          refreshToken: src.refreshToken,
          tokenType: src.tokenType,
          idToken: src.idToken,
          expiresAt: src.expiresAt,
          scope: src.scope,
          state: src.state,
          clientId: src.clientId,
          clientSecret: src.clientSecret,
          tokenUrl: src.tokenUrl,
          authUrl: src.authUrl,
          redirectUri: src.redirectUri,
          scopes: src.scopes,
          username: src.username,
          password: src.password,
          pkce: src.pkce,
          codeVerifier: src.codeVerifier,
          sendTokenIn: src.sendTokenIn === "query" ? "query" : "header",
          headerPrefix: src.headerPrefix,
          queryParamName: src.queryParamName,
          authMethod: src.authMethod === "post_body" ? "post_body" : "basic",
          useIdToken: src.useIdToken,
        },
      };
    }
    case "hawk":
      return {
        type,
        hawk: {
          id: raw.hawk?.id ?? raw.id ?? "",
          key: raw.hawk?.key ?? raw.key ?? "",
          algorithm: raw.hawk?.algorithm ?? raw.algorithm ?? "sha256",
        },
      };
    case "awsSigV4": {
      const src = raw.awsSigV4 ?? raw;
      return {
        type,
        awsSigV4: {
          accessKeyId: src.accessKeyId ?? "",
          secretAccessKey: src.secretAccessKey ?? "",
          sessionToken: src.sessionToken,
          region: src.region ?? "",
          service: src.service ?? "",
        },
      };
    }
    case "inherit":
      return { type: "inherit" };
    default:
      return { type: "none" };
  }
}

function deserializeVariable(raw: any): Variable {
  return {
    key: raw.key ?? "",
    value: raw.value ?? "",
    type: raw.type ?? "string",
    scope: raw.scope,
    enabled: raw.enabled !== false,
  };
}

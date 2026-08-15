import { parse, stringify, type DocumentOptions, type ToStringOptions } from "yaml";
import type {
  Collection,
  Folder,
  Request,
  Environment,
  Variable,
  AuthConfig,
  KeyValuePair,
  BodyContent,
  HttpMethod,
} from "@knockport/core";

// ── Byte-stable YAML serialization ───────────────────────────────────────────
// Three rules that make or break the git story:
// 1. Byte-stable serialization — stable key order, LF, no trailing whitespace
// 2. Ordering lives in folder.yaml as an order: [...] list
// 3. Secrets are references, never values

const DOC_OPTS: DocumentOptions = { strict: false };
const STR_OPTS: ToStringOptions = {
  lineWidth: 0,
  minContentWidth: 0,
  singleQuote: false,
};

/**
 * Serialize a collection to byte-stable YAML.
 * - Stable key order via sorted serialization
 * - LF line endings
 * - No trailing whitespace
 * - No regenerated IDs
 */
export function serializeCollection(collection: Collection): string {
  const doc = collectionToYamlDoc(collection);
  const raw = stringify(doc, STR_OPTS);
  return normalizeOutput(raw);
}

/**
 * Deserialize a collection from YAML.
 */
export function deserializeCollection(yaml: string): Collection {
  const doc = parse(yaml, DOC_OPTS) as RawCollection;
  return rawToCollection(doc);
}

/**
 * Serialize an environment to byte-stable YAML.
 */
export function serializeEnvironment(env: Environment): string {
  const doc = {
    name: env.name,
    variables: env.variables.map(serializeVariable),
  };
  const raw = stringify(doc, STR_OPTS);
  return normalizeOutput(raw);
}

/**
 * Deserialize an environment from YAML.
 */
export function deserializeEnvironment(yaml: string): Environment {
  const doc = parse(yaml, DOC_OPTS) as any;
  return {
    id: doc.id ?? "",
    name: doc.name,
    variables: (doc.variables ?? []).map(deserializeVariable),
    isDefault: doc.isDefault,
  };
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
  return rawToRequest(doc);
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
    name: c.name,
    description: c.description,
    auth: c.auth?.type !== "none" ? serializeAuth(c.auth) : undefined,
    scripts: c.scripts
      ? { pre: c.scripts.pre, test: c.scripts.test }
      : undefined,
    variables: c.variables.map(serializeVariable),
    order: c.order,
    folders: c.folders.map(folderToYamlDoc),
    requests: c.requests.map(requestToYamlDoc),
  };
}

function folderToYamlDoc(f: Folder): Record<string, any> {
  return {
    name: f.name,
    description: f.description,
    auth: f.auth?.type !== "none" ? serializeAuth(f.auth) : undefined,
    scripts: f.scripts
      ? { pre: f.scripts.pre, test: f.scripts.test }
      : undefined,
    order: f.order,
    folders: f.folders.map(folderToYamlDoc),
    requests: f.requests.map(requestToYamlDoc),
  };
}

function requestToYamlDoc(r: Request): Record<string, any> {
  return {
    name: r.name,
    method: r.method,
    url: r.url,
    headers: serializePairs(r.headers),
    params: serializePairs(r.params),
    body: serializeBody(r.body),
    auth: r.auth?.type !== "inherit" ? serializeAuth(r.auth) : undefined,
    scripts: r.scripts
      ? { pre: r.scripts.pre, test: r.scripts.test }
      : undefined,
    assertions: r.assertions?.length ? r.assertions : undefined,
    load: r.load
      ? { vus: r.load.vus, duration: r.load.duration, thresholds: r.load.thresholds }
      : undefined,
  };
}

function serializePairs(pairs: KeyValuePair[]): Record<string, string>[] | undefined {
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
  return { type: auth.type, ...auth[auth.type as keyof AuthConfig] };
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
  name: string;
  description?: string;
  auth?: any;
  scripts?: { pre?: string; test?: string };
  variables?: any[];
  order?: string[];
  folders?: any[];
  requests?: any[];
}

function rawToCollection(raw: RawCollection): Collection {
  return {
    id: "",
    name: raw.name,
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
    id: "",
    name: raw.name,
    description: raw.description,
    auth: raw.auth ? deserializeAuth(raw.auth) : undefined,
    scripts: raw.scripts,
    folders: (raw.folders ?? []).map(rawToFolder),
    requests: (raw.requests ?? []).map(rawToRequest),
    order: raw.order ?? [],
  };
}

function rawToRequest(raw: any): Request {
  return {
    id: "",
    name: raw.name,
    method: (raw.method ?? "GET") as HttpMethod,
    url: raw.url ?? "",
    headers: (raw.headers ?? []).map(deserializePair),
    params: (raw.params ?? []).map(deserializePair),
    body: raw.body
      ? { type: raw.body.type, content: raw.body.content, formData: raw.body.formData, graphql: raw.body.graphql }
      : { type: "none" },
    auth: raw.auth ? deserializeAuth(raw.auth) : { type: "inherit" },
    scripts: raw.scripts,
    assertions: raw.assertions,
    load: raw.load,
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

function deserializeAuth(raw: any): AuthConfig {
  return { type: raw.type ?? "none", ...raw };
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



import type {
  AuthConfig,
  BodyContent,
  Collection,
  Folder,
  FormDataEntry,
  HttpMethod,
  KeyValuePair,
  Request,
  Variable,
} from "@knockport/core";
import { createId } from "@knockport/core";

// ── Tropel Scenario JSON types (the @tropel/input-wasm output shape) ────────
// Protocol-agnostic `tropel-sdk::Scenario` serialized by the input slice:
//   { info, items, variables, auth } — items nest folders via `items`.

interface ScenarioJson {
  info: { name: string; description?: string | null; schema?: string | null };
  items: ScenarioItemJson[];
  variables?: Record<string, unknown>;
  auth?: AuthConfigJson | null;
}

export type { ScenarioJson };

interface ScenarioItemJson {
  id?: string | null;
  name: string;
  request?: TropelRequestJson | null;
  prerequest?: string[];
  test?: string[];
  assertions?: string[];
  items?: ScenarioItemJson[];
}

/** `tropel-sdk::Request` — headers serialize as `[name, value]` pairs. */
interface TropelRequestJson {
  url: string;
  method: string;
  headers: [string, string][];
  query_params: Record<string, string>;
  body?: BodyJson | null;
  auth?: AuthConfigJson | null;
  follow_redirects?: boolean;
  timeout?: number | null;
  response_type?: string;
}

/** `tropel-sdk::Body` custom serde: Raw→string, Json→raw value, others→
 * `{"__tropel_body":"<kind>", …}`. */
type BodyJson =
  | string
  | { __tropel_body: "form_data"; fields: FormDataPartJson[] }
  | { __tropel_body: "url_encoded"; fields: [string, string][] }
  | { __tropel_body: "binary"; data: number[] }
  | { __tropel_body: "graphql"; query: string; variables?: Record<string, unknown> | null }
  | Record<string, unknown>;

interface FormDataPartJson {
  name: string;
  value?: string | null;
  filename?: string | null;
  mime?: string | null;
  data?: number[] | null;
}

/** `tropel-sdk::AuthConfig` — internally-tagged on `type`. */
type AuthConfigJson =
  | { type: "noauth" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; key: string; value: string; location: string }
  | { type: "digest"; username: string; password: string }
  | {
      type: "oauth1";
      consumer_key: string;
      consumer_secret: string;
      token?: string | null;
      token_secret?: string | null;
    }
  | { type: "oauth2"; access_token: string; token_type?: string | null }
  | {
      type: "aws-sigv4";
      access_key: string;
      secret_key: string;
      region?: string | null;
      service?: string | null;
      session_token?: string | null;
    }
  | { type: "hawk"; auth_id: string; auth_key: string; algorithm?: string | null };

function now(): string {
  return new Date().toISOString();
}

function isMethod(v: string): v is HttpMethod {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"].includes(
    v.toUpperCase(),
  );
}

// ── Auth mapping ─────────────────────────────────────────────────────────────
function mapAuth(auth: AuthConfigJson | null | undefined): AuthConfig {
  if (!auth) return { type: "none" };
  switch (auth.type) {
    case "noauth":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", bearer: { token: auth.token } };
    case "basic":
      return { type: "basic", basic: { username: auth.username, password: auth.password } };
    case "apikey":
      return {
        type: "apiKey",
        apiKey: {
          key: auth.key,
          value: auth.value,
          in: auth.location === "query" ? "query" : "header",
        },
      };
    case "digest":
      return { type: "digest", digest: { username: auth.username, password: auth.password } };
    case "oauth1":
      return {
        type: "oauth1",
        oauth1: {
          consumerKey: auth.consumer_key,
          consumerSecret: auth.consumer_secret,
          token: auth.token ?? "",
          tokenSecret: auth.token_secret ?? "",
          signatureMethod: "HMAC-SHA1",
        },
      };
    case "oauth2":
      return {
        type: "oauth2",
        oauth2: {
          grantType: "authorization_code",
          accessToken: auth.access_token,
          tokenType: auth.token_type ?? undefined,
          sendTokenIn: "header",
          headerPrefix: auth.token_type ?? "Bearer",
        },
      };
    case "aws-sigv4":
      return {
        type: "aws-sigv4",
        awsSigV4: {
          accessKeyId: auth.access_key,
          secretAccessKey: auth.secret_key,
          sessionToken: auth.session_token ?? undefined,
          region: auth.region ?? "",
          service: auth.service ?? "",
        },
      };
    case "hawk":
      return {
        type: "hawk",
        hawk: { id: auth.auth_id, key: auth.auth_key, algorithm: auth.algorithm === "sha1" ? "sha1" : "sha256" },
      };
    default:
      return { type: "none" };
  }
}

// ── Body mapping ─────────────────────────────────────────────────────────────
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function mapBody(body: BodyJson | null | undefined): BodyContent {
  if (body === null || body === undefined) return { type: "none" };
  if (typeof body === "string") {
    return looksLikeJson(body) ? { type: "json", content: body } : { type: "text", content: body };
  }
  const tag = (body as { __tropel_body?: string }).__tropel_body;
  switch (tag) {
    case "form_data": {
      const fields = (body as { fields: FormDataPartJson[] }).fields ?? [];
      const formData: FormDataEntry[] = fields.map((part) => {
        if (part.value !== null && part.value !== undefined) {
          return {
            key: part.name,
            value: part.value,
            type: "text",
            enabled: true,
            contentType: part.mime ?? undefined,
          };
        }
        return {
          key: part.name,
          value: part.filename ?? "",
          type: "file",
          enabled: true,
          contentType: part.mime ?? undefined,
        };
      });
      return { type: "multipart-form", formData };
    }
    case "url_encoded": {
      const fields = (body as { fields: [string, string][] }).fields ?? [];
      return {
        type: "form-urlencoded",
        content: fields.map(([k, v]) => `${k}=${v}`).join("&"),
      };
    }
    case "graphql": {
      const { query, variables } = body as { query: string; variables?: Record<string, unknown> | null };
      return {
        type: "graphql",
        graphql: { query, variables: variables ? JSON.stringify(variables) : undefined },
      };
    }
    case "binary":
      return { type: "binary" };
    default:
      // Plain JSON value (Json variant serializes as the raw value).
      return { type: "json", content: JSON.stringify(body) };
  }
}

// ── Request mapping ──────────────────────────────────────────────────────────
function mapRequest(item: ScenarioItemJson): Request {
  const r = item.request ?? ({} as TropelRequestJson);
  const params: KeyValuePair[] = Object.entries(r.query_params ?? {}).map(([key, value]) => ({
    key,
    value: String(value),
    enabled: true,
  }));
  const headers: KeyValuePair[] = (r.headers ?? []).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));
  const ts = now();
  return {
    id: createId("req"),
    name: item.name || `${r.method ?? "GET"} ${r.url ?? ""}`,
    method: isMethod(r.method) ? (r.method.toUpperCase() as HttpMethod) : "GET",
    url: r.url ?? "",
    headers,
    params,
    body: mapBody(r.body),
    auth: mapAuth(r.auth),
    settings: r.follow_redirects === false ? { followRedirects: false } : undefined,
    metadata: { createdAt: ts, updatedAt: ts },
  };
}

// ── Folder mapping (ScenarioItem with `items` = folder) ─────────────────────
function mapFolder(item: ScenarioItemJson): Folder {
  const children = item.items ?? [];
  const folders: Folder[] = [];
  const requests: Request[] = [];
  const order: string[] = [];
  for (const child of children) {
    if ((child.items?.length ?? 0) > 0) {
      const folder = mapFolder(child);
      folders.push(folder);
      order.push(folder.id);
    } else {
      const request = mapRequest(child);
      requests.push(request);
      order.push(request.id);
    }
  }
  return {
    id: createId("fld"),
    name: item.name || "Folder",
    folders,
    requests,
    order,
  };
}

// ── Collection mapping ───────────────────────────────────────────────────────
/**
 * Map a Tropel `Scenario` JSON document (from `@tropel/input-wasm`
 * `importAny`/`importById`) to a KnockPort `Collection`. The scenario's
 * top-level items become collection-level requests and folders; nested
 * `items` recurse into `Folder`. Fresh KnockPort IDs throughout so importing
 * a scenario never collides with existing records.
 */
export function scenarioToCollection(scenarioJson: string | ScenarioJson): Collection {
  const scenario: ScenarioJson =
    typeof scenarioJson === "string" ? (JSON.parse(scenarioJson) as ScenarioJson) : scenarioJson;

  const folders: Folder[] = [];
  const requests: Request[] = [];
  const order: string[] = [];
  for (const item of scenario.items ?? []) {
    if ((item.items?.length ?? 0) > 0) {
      const folder = mapFolder(item);
      folders.push(folder);
      order.push(folder.id);
    } else {
      const request = mapRequest(item);
      requests.push(request);
      order.push(request.id);
    }
  }

  const variables: Variable[] = Object.entries(scenario.variables ?? {}).map(([key, value]) => ({
    key,
    value: String(value),
    enabled: true,
  }));

  const ts = now();
  const collection: Collection = {
    id: createId("col"),
    name: scenario.info.name || "Imported Collection",
    description: scenario.info.description ?? undefined,
    auth: mapAuth(scenario.auth),
    variables,
    folders,
    requests,
    order,
    metadata: {
      version: scenario.info.schema ?? undefined,
      createdAt: ts,
      updatedAt: ts,
    },
  };
  return collection;
}
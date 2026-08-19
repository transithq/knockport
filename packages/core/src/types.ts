// ── HTTP Methods ─────────────────────────────────────────────────────────────
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

// ── Auth Types ───────────────────────────────────────────────────────────────
export type OAuth2GrantType = "authorization_code" | "client_credentials" | "password" | "implicit";

export type AuthType =
  | "none"
  | "inherit"
  | "bearer"
  | "basic"
  | "apiKey"
  | "digest"
  | "oauth1"
  | "oauth2"
  | "hawk"
  | "aws-sigv4";

export interface AuthConfig {
  type: AuthType;
  bearer?: { token: string };
  basic?: { username: string; password: string };
  apiKey?: { key: string; value: string; in: "header" | "query" };
  digest?: { username: string; password: string };
  oauth1?: {
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
    signatureMethod: "HMAC-SHA1" | "HMAC-SHA256" | "RSA-SHA1";
  };
  oauth2?: {
    grantType: OAuth2GrantType;
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    /** OIDC: the id_token from the last exchange. */
    idToken?: string;
    /** Absolute UNIX seconds; absent = no expiry advertised. */
    expiresAt?: number;
    scope?: string;
    /** In-flight authorization-code exchange state (opaque, verified by provider). */
    state?: string;
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
    authUrl?: string;
    redirectUri?: string;
    scopes?: string[];
    /** password grant */
    username?: string;
    password?: string;
    /** PKCE (authorization_code); verifier generated per exchange. */
    pkce?: boolean;
    codeVerifier?: string;
    /** Where the token is attached on send. */
    sendTokenIn?: "header" | "query";
    headerPrefix?: string;
    queryParamName?: string;
    /** Client credentials strategy at the token endpoint. */
    authMethod?: "basic" | "post_body";
    /** OIDC: send the id_token instead of the access_token. */
    useIdToken?: boolean;
  };
  hawk?: { id: string; key: string; algorithm: "sha256" | "sha1" };
  awsSigV4?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
    service: string;
  };
}

// ── Body Types ───────────────────────────────────────────────────────────────
export type BodyType =
  | "none"
  | "json"
  | "text"
  | "xml"
  | "html"
  | "form-urlencoded"
  | "multipart-form"
  | "binary"
  | "graphql";

export interface BodyContent {
  type: BodyType;
  content?: string;
  formData?: FormDataEntry[];
  graphql?: { query: string; variables?: string };
  /** In-memory file for binary bodies (E1). Never persisted — serializers
   * replace it with a `[file]` marker. */
  file?: File;
}

export interface FormDataEntry {
  key: string;
  value: string | File;
  type: "text" | "file";
  enabled: boolean;
}

// ── Headers & Params ─────────────────────────────────────────────────────────
export interface KeyValuePair {
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

// ── Request ──────────────────────────────────────────────────────────────────
export interface Request {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  params: KeyValuePair[];
  body: BodyContent;
  auth: AuthConfig;
  /** Request-scoped variables (req side): seed the interpolation map above
   *  the environment layer (Bruno/Hoppscotch `vars:pre-request`). */
  requestVars?: RequestVariable[];
  /** Response variables (res side): JS expressions evaluated against the
   *  response after it arrives; results enter the runtime variable scope for
   *  post-response/test scripts and the runner's next request. */
  responseVars?: ResponseVariable[];
  scripts?: RequestScripts;
  assertions?: Assertion[];
  load?: LoadConfig;
  settings?: RequestSettings;
  metadata?: RequestMetadata;
  /** Saved request+response pairs (F4 "save as example"). */
  examples?: RequestExample[];
}

/** Plain key/value pair with an enabled flag (no type dropdown — values flow
 *  through `{{...}}` interpolation as strings). */
export interface RequestVariable {
  key: string;
  value: string;
  enabled?: boolean;
}

/** Post-response variable: `value` is a JS expression evaluated against the
 *  response object (`res.json()…`, `res.header(...)`, `res.status`, …). */
export interface ResponseVariable {
  key: string;
  value: string;
  enabled?: boolean;
}

export interface RequestScripts {
  pre?: string;
  test?: string;
  /**
   * Post-response script: runs after the response arrives, with full
   * `kp.response` access. Intended for side effects (extracting tokens,
   * preparing the next request) rather than assertions — assertions belong
   * in `test`. Mutated runtime variables carry into the next request in the
   * collection runner.
   */
  postResponse?: string;
}

export interface Assertion {
  expression: string;
  description?: string;
}

export interface LoadConfig {
  vus: number;
  duration: string;
  thresholds: string[];
}

export interface RequestSettings {
  followRedirects?: boolean;
  maxRedirects?: number;
  timeout?: number;
  verifySSL?: boolean;
}

export interface RequestMetadata {
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

/** A saved request+response pair attached to a request (F4). */
export interface RequestExample {
  id: string;
  /** The request as it produced this response (may carry {{var}} refs). */
  request: Request;
  /** The captured response. */
  response: Response;
  /** When the example was saved. */
  timestamp: string;
}

// ── Response ─────────────────────────────────────────────────────────────────
export interface Response {
  id: string;
  requestId: string;
  /** Fully-resolved URL that was fetched (after variable resolution). */
  url?: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Text body (UTF-8). Empty for binary/media responses that carry bytes. */
  body: string;
  /** Raw bytes for binary/media responses, base64-encoded (F1). */
  bodyBase64?: string;
  bodySize: number;
  contentType?: string;
  timings: ResponseTimings;
  cookies: ResponseCookie[];
  timestamp: string;
}

export interface ResponseTimings {
  total: number;
  dns?: number;
  tcp?: number;
  tls?: number;
  ttfb: number;
  download: number;
  redirect?: number;
}

export interface ResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

// ── Collection ───────────────────────────────────────────────────────────────
export interface Collection {
  id: string;
  name: string;
  description?: string;
  auth?: AuthConfig;
  /** Headers applied to every request in the collection (entries set on a
   *  folder or on the request itself win on duplicate names). */
  headers?: KeyValuePair[];
  scripts?: RequestScripts;
  /** Declarative assertions applied to every request in the collection. */
  assertions?: Assertion[];
  variables: Variable[];
  folders: Folder[];
  requests: Request[];
  order: string[];
  metadata?: CollectionMetadata;
}

export interface Folder {
  id: string;
  name: string;
  /** Markdown docs (B§9 folderRootSchema.docs), shown in the Overview pane. */
  description?: string;
  /** Inherited by every request in the folder when its auth type is `inherit`. */
  auth?: AuthConfig;
  /** Headers applied to every request in the folder (request entries win on
   *  duplicate names). */
  headers?: KeyValuePair[];
  scripts?: RequestScripts;
  /** Assertions applied to every request in the folder. */
  assertions?: Assertion[];
  /** Folder-scoped variables: merge over the collection + environment
   *  layers, under request variables. */
  variables?: FolderVariable[];
  folders: Folder[];
  requests: Request[];
  order: string[];
}

/** Folder-scoped variable — same plain key/value shape as request vars. */
export type FolderVariable = RequestVariable;

export interface CollectionMetadata {
  version?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Variables & Environments ─────────────────────────────────────────────────
export type VariableScope = "data" | "env" | "collection" | "globals" | "local";

export interface Variable {
  key: string;
  value: string;
  type?: "string" | "number" | "boolean" | "secret";
  scope?: VariableScope;
  enabled?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: Variable[];
  isDefault?: boolean;
}

export interface SecretReference {
  from: "env" | "keychain";
  key: string;
}

// ── History ──────────────────────────────────────────────────────────────────
export interface HistoryEntry {
  id: string;
  request: Request;
  response: Response;
  timestamp: string;
  collectionId?: string;
  environmentId?: string;
}

// ── Plugin System ────────────────────────────────────────────────────────────
export type PluginCapability =
  | "read:response"
  | "read:collections"
  | "read:secrets"
  | "write:collections"
  | "ui:panel"
  | "ui:tab"
  | "net:*";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  capabilities: PluginCapability[];
  contributes?: PluginContributions;
}

export interface PluginContributions {
  panels?: PluginPanel[];
  visualizers?: PluginVisualizer[];
  importers?: PluginImporter[];
  codegens?: PluginCodegen[];
  authProviders?: PluginAuthProvider[];
  themes?: PluginTheme[];
}

export interface PluginPanel {
  id: string;
  title: string;
  icon?: string;
}

export interface PluginVisualizer {
  match: string;
  render: string;
}

export interface PluginImporter {
  name: string;
  extensions: string[];
}

export interface PluginCodegen {
  name: string;
  language: string;
}

export interface PluginAuthProvider {
  name: string;
  type: AuthType;
}

export interface PluginTheme {
  name: string;
  mode: "light" | "dark";
}

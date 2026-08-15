import type { Collection, Folder, Request, KeyValuePair, HttpMethod, AuthConfig, BodyContent } from "@knockport/core";
import { createId } from "@knockport/core";

// ── Helpers ──────────────────────────────────────────────────────────────────
function baseRequest(partial: Partial<Request> & Pick<Request, "name" | "method" | "url">): Request {
  return {
    id: createId("req"),
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "none" },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ...partial,
  };
}

function isMethod(v: string): v is HttpMethod {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"].includes(v.toUpperCase());
}

function splitUrl(url: string): { url: string; params: KeyValuePair[] } {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return { url, params: [] };
  const base = url.slice(0, qIndex);
  const query = url.slice(qIndex + 1);
  const params = query
    .split("&")
    .filter(Boolean)
    .map((kv) => {
      const [k, v = ""] = kv.split("=");
      return { key: decodeURIComponent(k), value: decodeURIComponent(v), enabled: true };
    });
  return { url: base, params };
}

// ── cURL importer ────────────────────────────────────────────────────────────
export function importCurl(input: string): Request {
  const tokens = tokenize(input);
  let method: HttpMethod = "GET";
  let url = "";
  const headers: KeyValuePair[] = [];
  const dataParts: string[] = [];
  const formParts: KeyValuePair[] = [];
  let user: string | null = null;
  let hasData = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case "-X":
      case "--request":
        if (isMethod(tokens[i + 1] ?? "")) method = tokens[++i].toUpperCase() as HttpMethod;
        break;
      case "-H":
      case "--header": {
        const hv = tokens[++i] ?? "";
        const ci = hv.indexOf(":");
        if (ci > -1) headers.push({ key: hv.slice(0, ci).trim(), value: hv.slice(ci + 1).trim(), enabled: true });
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-urlencode":
        dataParts.push(tokens[++i] ?? "");
        hasData = true;
        break;
      case "-F":
      case "--form": {
        const fv = tokens[++i] ?? "";
        const [k, v = ""] = fv.split("=");
        formParts.push({ key: k, value: v.replace(/^@/, ""), enabled: true });
        break;
      }
      case "-u":
      case "--user":
        user = tokens[++i] ?? null;
        break;
      default:
        if (!t.startsWith("-") && !url) url = t;
    }
  }

  if (hasData && method === "GET") method = "POST";

  const { url: cleanUrl, params } = splitUrl(url);

  let body: BodyContent = { type: "none" };
  if (formParts.length > 0) {
    body = { type: "multipart-form", formData: formParts.map((p) => ({ key: p.key, value: p.value, type: "text", enabled: true })) };
  } else if (dataParts.length > 0) {
    const joined = dataParts.join("&");
    body = looksLikeJson(joined) ? { type: "json", content: joined } : { type: "form-urlencoded", content: joined };
  }

  const auth: AuthConfig = { type: "none" };
  const authHeader = headers.find((h) => h.key.toLowerCase() === "authorization");
  if (authHeader?.value.toLowerCase().startsWith("bearer ")) {
    auth.type = "bearer";
    auth.bearer = { token: authHeader.value.slice(7).trim() };
  } else if (user) {
    const [username, password = ""] = user.split(":");
    auth.type = "basic";
    auth.basic = { username, password };
  }

  return baseRequest({ name: "Imported cURL", method, url: cleanUrl, headers, params, body, auth });
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

// ── Postman v2.1 importer ────────────────────────────────────────────────────
interface PostmanItem {
  name?: string;
  request?: any;
  item?: PostmanItem[];
}

export function importPostman(json: string): Collection {
  const doc = JSON.parse(json);
  const name = doc.info?.name ?? "Imported Collection";

  const collection: Collection = {
    id: createId("col"),
    name,
    description: doc.info?.description ?? undefined,
    variables: (doc.variable ?? []).map((v: any) => ({ key: v.key ?? "", value: String(v.value ?? ""), enabled: true })),
    folders: [],
    requests: [],
    order: [],
    auth: { type: "none" },
    metadata: { version: "1.0.0", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  for (const item of doc.item ?? []) {
    if (item.item) {
      collection.folders.push(postmanFolder(item));
    } else if (item.request) {
      collection.requests.push(postmanRequest(item));
    }
  }
  collection.order = [...collection.folders.map((f) => f.id), ...collection.requests.map((r) => r.id)];
  return collection;
}

function postmanFolder(item: PostmanItem): Folder {
  const folder: Folder = {
    id: createId("fld"),
    name: item.name ?? "Folder",
    folders: [],
    requests: [],
    order: [],
  };
  for (const child of item.item ?? []) {
    if (child.item) folder.folders.push(postmanFolder(child));
    else if (child.request) folder.requests.push(postmanRequest(child));
  }
  folder.order = [...folder.folders.map((f) => f.id), ...folder.requests.map((r) => r.id)];
  return folder;
}

function postmanRequest(item: PostmanItem): Request {
  const r = item.request ?? {};
  const urlObj = typeof r.url === "string" ? { raw: r.url } : r.url ?? {};
  const { url, params: qParams } = splitUrl(urlObj.raw ?? "");

  const headers: KeyValuePair[] = (r.header ?? []).map((h: any) => ({
    key: h.key ?? "",
    value: h.value ?? "",
    enabled: h.disabled !== true,
  }));

  const params: KeyValuePair[] = [
    ...qParams,
    ...(urlObj.query ?? []).map((q: any) => ({ key: q.key ?? "", value: q.value ?? "", enabled: q.disabled !== true })),
  ];

  const body = postmanBody(r.body);
  const auth = postmanAuth(r.auth);

  return baseRequest({ name: item.name ?? "Request", method: (r.method ?? "GET").toUpperCase() as HttpMethod, url, headers, params, body, auth });
}

function postmanBody(b: any): BodyContent {
  if (!b || b.mode === "raw") {
    if (!b?.raw) return { type: "none" };
    const lang = b.options?.raw?.language ?? "json";
    const type = lang === "json" ? "json" : lang === "xml" ? "xml" : lang === "html" ? "html" : "text";
    return { type, content: b.raw };
  }
  if (b.mode === "urlencoded") {
    return {
      type: "form-urlencoded",
      content: (b.urlencoded ?? []).map((p: any) => `${p.key}=${p.value}`).join("&"),
    };
  }
  if (b.mode === "formdata") {
    return {
      type: "multipart-form",
      formData: (b.formdata ?? []).map((p: any) => ({ key: p.key ?? "", value: p.value ?? "", type: p.type === "file" ? "file" : "text", enabled: p.disabled !== true })),
    };
  }
  if (b.mode === "graphql") {
    return { type: "graphql", graphql: { query: b.graphql?.query ?? "", variables: b.graphql?.variables ?? "" } };
  }
  return { type: "none" };
}

function postmanAuth(a: any): AuthConfig {
  if (!a) return { type: "none" };
  switch (a.type) {
    case "bearer":
      return { type: "bearer", bearer: { token: findAuthValue(a.bearer, "token") } };
    case "basic":
      return { type: "basic", basic: { username: findAuthValue(a.basic, "username"), password: findAuthValue(a.basic, "password") } };
    case "apikey":
      return { type: "apiKey", apiKey: { key: findAuthValue(a.apikey, "key"), value: findAuthValue(a.apikey, "value"), in: findAuthValue(a.apikey, "in") === "query" ? "query" : "header" } };
    default:
      return { type: "none" };
  }
}

function findAuthValue(arr: any, key: string): string {
  if (!Array.isArray(arr)) return "";
  const entry = arr.find((x: any) => x.key === key);
  return entry?.value ?? "";
}

// ── HAR importer ─────────────────────────────────────────────────────────────
export function importHar(json: string): Collection {
  const doc = JSON.parse(json);
  const entries = doc.log?.entries ?? [];

  const collection: Collection = {
    id: createId("col"),
    name: "Imported HAR",
    variables: [],
    folders: [],
    requests: [],
    order: [],
    auth: { type: "none" },
    metadata: { version: "1.0.0", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  for (const entry of entries) {
    const req = entry.request;
    if (!req) continue;
    const { url, params } = splitUrl(req.url ?? "");
    collection.requests.push(
      baseRequest({
        name: `${req.method} ${new URL(req.url ?? "http://localhost").pathname}`,
        method: (req.method ?? "GET").toUpperCase() as HttpMethod,
        url,
        params: [...params, ...(req.queryString ?? []).map((q: any) => ({ key: q.name ?? "", value: q.value ?? "", enabled: true }))],
        headers: (req.headers ?? []).map((h: any) => ({ key: h.name ?? "", value: h.value ?? "", enabled: true })),
        body: req.postData?.text ? { type: "json", content: req.postData.text } : { type: "none" },
      }),
    );
  }
  collection.order = collection.requests.map((r) => r.id);
  return collection;
}

// ── Auto-detect importer ─────────────────────────────────────────────────────
export function importAuto(input: string): Collection | Request {
  const trimmed = input.trim();
  if (trimmed.startsWith("curl ") || trimmed.startsWith("curl\n")) return importCurl(trimmed);
  try {
    const doc = JSON.parse(trimmed);
    if (doc.log?.entries) return importHar(trimmed);
    if (doc.info?.schema?.includes("postman") || doc.item) return importPostman(trimmed);
  } catch {
    // not JSON — treat as curl
  }
  return importCurl(trimmed);
}

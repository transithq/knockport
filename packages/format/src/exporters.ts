import type { Collection, Folder, Request } from "@knockport/core";

// ── Exporters ────────────────────────────────────────────────────────────────

/**
 * Export a collection as native KnockPort JSON (round-trips through
 * deserializeCollection after IDs are regenerated on import).
 */
export function exportJson(collection: Collection): string {
  return JSON.stringify(collection, null, 2);
}

/**
 * Export a collection in Postman v2.1 format so it can be imported into
 * Postman/Insomnia/Bruno and re-imported by our own Postman importer.
 */
export function exportPostman(collection: Collection): string {
  return JSON.stringify(collectionToPostman(collection), null, 2);
}

function collectionToPostman(c: Collection): Record<string, unknown> {
  return {
    info: {
      _postman_id: c.id,
      name: c.name,
      description: c.description ?? "",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [...c.folders.map(folderToPostman), ...c.requests.map(requestToPostman)],
    variable: c.variables.map((v) => ({ key: v.key, value: v.value, disabled: v.enabled === false })),
  };
}

function folderToPostman(f: Folder): Record<string, unknown> {
  return {
    name: f.name,
    description: f.description ?? "",
    item: [...f.folders.map(folderToPostman), ...f.requests.map(requestToPostman)],
  };
}

function requestToPostman(r: Request): Record<string, unknown> {
  const request: Record<string, unknown> = {
    method: r.method,
    header: r.headers.map((h) => ({
      key: h.key,
      value: h.value,
      disabled: h.enabled === false,
    })),
    url: buildPostmanUrl(r),
  };

  if (r.body && r.body.type !== "none") {
    if (r.body.type === "json" || r.body.type === "text" || r.body.type === "xml") {
      const language = r.body.type === "json" ? "json" : r.body.type === "xml" ? "xml" : "text";
      request.body = {
        mode: "raw",
        raw: r.body.content ?? "",
        options: { raw: { language } },
      };
    } else if (r.body.type === "multipart-form") {
      request.body = {
        mode: "formdata",
        formdata: (r.body.formData ?? []).map((f) => ({
          key: f.key,
          value: typeof f.value === "string" ? f.value : "",
          type: f.type === "file" ? "file" : "text",
          disabled: f.enabled === false,
        })),
      };
    } else if (r.body.type === "form-urlencoded") {
      request.body = {
        mode: "urlencoded",
        urlencoded: (r.body.formData ?? []).map((f) => ({
          key: f.key,
          value: typeof f.value === "string" ? f.value : "",
          disabled: f.enabled === false,
        })),
      };
    } else if (r.body.type === "graphql" && r.body.graphql) {
      request.body = {
        mode: "graphql",
        graphql: { query: r.body.graphql.query ?? "", variables: r.body.graphql.variables ?? "" },
      };
    }
  }

  if (r.auth && r.auth.type !== "inherit" && r.auth.type !== "none") {
    request.auth = authToPostman(r.auth);
  }

  return { name: r.name, request };
}

function buildPostmanUrl(r: Request): Record<string, unknown> {
  const query = r.params
    .filter((p) => p.key)
    .map((p) => ({ key: p.key, value: p.value, disabled: p.enabled === false }));
  const raw = query.length
    ? `${r.url}?${query.map((q) => `${q.key}=${q.value}`).join("&")}`
    : r.url;
  return { raw, query };
}

function authToPostman(auth: any): Record<string, unknown> {
  if (auth.type === "bearer") {
    return { type: "bearer", bearer: [{ key: "token", value: auth.bearer?.token ?? "", type: "string" }] };
  }
  if (auth.type === "basic") {
    return {
      type: "basic",
      basic: [
        { key: "username", value: auth.basic?.username ?? "", type: "string" },
        { key: "password", value: auth.basic?.password ?? "", type: "string" },
      ],
    };
  }
  if (auth.type === "apikey") {
    return {
      type: "apikey",
      apikey: [
        { key: "key", value: auth.apikey?.key ?? "", type: "string" },
        { key: "value", value: auth.apikey?.value ?? "", type: "string" },
        { key: "in", value: auth.apikey?.in ?? "header", type: "string" },
      ],
    };
  }
  return { type: "noauth" };
}

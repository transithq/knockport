import { describe, expect, it } from "vitest";
import type { Collection, Environment, Request } from "@knockport/core";
import {
  exportJson,
  importAuto,
  importKnockportJson,
  importKnockportYaml,
  serializeCollection,
  serializeEnvironment,
} from "./index";

function makeCollection(): Collection {
  const reqA: Request = {
    id: "req_a",
    name: "Get Users",
    method: "GET",
    url: "{{baseUrl}}/users",
    headers: [{ key: "Accept", value: "application/json", enabled: true }],
    params: [{ key: "limit", value: "10", enabled: true }],
    body: { type: "none" },
    auth: { type: "inherit" },
    scripts: { test: 'kp.test("200", () => kp.response.to.have.status(200));' },
    assertions: [{ expression: "status == 200" }],
  };
  const reqB: Request = {
    id: "req_b",
    name: "Create User",
    method: "POST",
    url: "{{baseUrl}}/users",
    headers: [],
    params: [],
    body: { type: "json", content: '{"name":"{{name}}"}' },
    auth: { type: "bearer", bearer: { token: "tok" } },
  };
  return {
    id: "col_x",
    name: "Round Trip",
    description: "desc",
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
    scripts: { pre: "kp.variables.set('x','1');" },
    variables: [{ key: "baseUrl", value: "https://api.example.com", type: "string", enabled: true }],
    folders: [
      {
        id: "fld_1",
        name: "Users",
        folders: [],
        requests: [reqB],
        order: ["req_b"],
      },
    ],
    requests: [reqA],
    order: ["fld_1", "req_a"],
  };
}

describe("native JSON round-trip", () => {
  it("importAuto detects a native collection JSON export", () => {
    const original = makeCollection();
    const imported = importAuto(exportJson(original)) as Collection;
    expect(imported.name).toBe("Round Trip");
    expect(imported.id).not.toBe(original.id); // IDs regenerated
    expect(imported.order).toHaveLength(2);
    expect(imported.folders[0].requests[0].body.content).toBe('{"name":"{{name}}"}');
    expect(imported.requests[0].auth.type).toBe("inherit");
    expect(imported.requests[0].scripts?.test).toContain("kp.test");
    expect(imported.auth?.type).toBe("bearer");
    expect(imported.auth?.bearer?.token).toBe("{{token}}");
  });

  it("round-tripped order still points at the regenerated children", () => {
    const original = makeCollection();
    const imported = importKnockportJson(exportJson(original)) as Collection;
    const childIds = new Set<string>([...imported.folders.map((f) => f.id), ...imported.requests.map((r) => r.id)]);
    for (const id of imported.order) expect(childIds.has(id)).toBe(true);
    // folder order preserved relative to its request
    const folder = imported.folders[0];
    expect(folder.order).toEqual([folder.requests[0].id]);
  });

  it("imports an environment JSON export", () => {
    const env: Environment = {
      id: "env_1",
      name: "Prod",
      variables: [{ key: "baseUrl", value: "https://prod.example.com", enabled: true }],
    };
    const imported = importAuto(JSON.stringify(env)) as Environment;
    expect(imported.name).toBe("Prod");
    expect(imported.id).not.toBe("env_1");
    expect(imported.variables[0].value).toBe("https://prod.example.com");
  });
});

describe("native YAML round-trip", () => {
  it("round-trips a collection through serializeCollection → importKnockportYaml", () => {
    const original = makeCollection();
    const yaml = serializeCollection(original);
    const imported = importKnockportYaml(yaml) as Collection;
    expect(imported.name).toBe("Round Trip");
    expect(imported.description).toBe("desc");
    expect(imported.variables[0].key).toBe("baseUrl");
    expect(imported.requests[0].url).toBe("{{baseUrl}}/users");
    expect(imported.requests[0].assertions?.[0].expression).toBe("status == 200");
    expect(imported.folders[0].requests[0].auth.type).toBe("bearer");
  });

  it("round-trips request examples (F4)", () => {
    const original = makeCollection();
    original.requests[0].examples = [
      {
        id: "ex_1",
        timestamp: "2026-01-02T03:04:05.000Z",
        request: {
          id: "req_a",
          name: "Get Users",
          method: "GET",
          url: "{{baseUrl}}/users",
          headers: [],
          params: [],
          body: { type: "none" },
          auth: { type: "inherit" },
        },
        response: {
          id: "resp_1",
          requestId: "req_a",
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body: '{"users":[]}',
          bodySize: 12,
          contentType: "application/json",
          timings: { total: 12, ttfb: 5, download: 7 },
          cookies: [],
          timestamp: "2026-01-02T03:04:05.000Z",
        },
      },
    ];
    const yaml = serializeCollection(original);
    const imported = importKnockportYaml(yaml) as Collection;
    const examples = imported.requests[0].examples ?? [];
    expect(examples).toHaveLength(1);
    expect(examples[0].id).toBe("ex_1");
    expect(examples[0].request.method).toBe("GET");
    expect(examples[0].response.status).toBe(200);
    expect(examples[0].response.body).toBe('{"users":[]}');
    expect(examples[0].response.contentType).toBe("application/json");
  });

  it("binary bodies with a File serialize to a [file] marker (E1)", () => {
    const original = makeCollection();
    original.requests[0].body = { type: "binary", file: new File(["x"], "photo.png") };
    const yaml = serializeCollection(original);
    const imported = importKnockportYaml(yaml) as Collection;
    expect(imported.requests[0].body.type).toBe("binary");
    expect(imported.requests[0].body.content).toBe("[file: photo.png]");
    expect(imported.requests[0].body.file).toBeUndefined();
  });

  it("round-trips the full OAuth2 auth block (B1 fields)", () => {
    const original = makeCollection();
    original.auth = {
      type: "oauth2",
      oauth2: {
        grantType: "authorization_code",
        authUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        clientId: "cid",
        clientSecret: "csec",
        redirectUri: "https://cb",
        scopes: ["read", "write"],
        pkce: true,
        sendTokenIn: "query",
        queryParamName: "tok",
        authMethod: "post_body",
        useIdToken: true,
        accessToken: "acc",
        refreshToken: "ref",
        tokenType: "Bearer",
        idToken: "idt",
        expiresAt: 2_000_000_000,
        scope: "read write",
      },
    };
    const imported = importKnockportYaml(serializeCollection(original)) as Collection;
    const o2 = imported.auth?.oauth2;
    expect(o2?.grantType).toBe("authorization_code");
    expect(o2?.authUrl).toBe("https://auth.example.com/authorize");
    expect(o2?.redirectUri).toBe("https://cb");
    expect(o2?.scopes).toEqual(["read", "write"]);
    expect(o2?.pkce).toBe(true);
    expect(o2?.sendTokenIn).toBe("query");
    expect(o2?.queryParamName).toBe("tok");
    expect(o2?.authMethod).toBe("post_body");
    expect(o2?.useIdToken).toBe(true);
    expect(o2?.accessToken).toBe("acc");
    expect(o2?.refreshToken).toBe("ref");
    expect(o2?.idToken).toBe("idt");
    expect(o2?.expiresAt).toBe(2_000_000_000);
  });

  it("importAuto detects native collection YAML", () => {
    const original = makeCollection();
    const imported = importAuto(serializeCollection(original)) as Collection;
    expect(imported.name).toBe("Round Trip");
    expect(imported.folders).toHaveLength(1);
  });

  it("round-trips an environment via serializeEnvironment", () => {
    const env: Environment = {
      id: "env_1",
      name: "Dev",
      variables: [
        { key: "host", value: "localhost", enabled: true },
        { key: "secret", value: "", type: "secret", enabled: false },
      ],
    };
    const imported = importAuto(serializeEnvironment(env)) as Environment;
    expect(imported.name).toBe("Dev");
    expect(imported.id).not.toBe("env_1");
    expect(imported.variables).toHaveLength(2);
    expect(imported.variables[1].enabled).toBe(false);
  });

  it("round-trips request-level variables (A1)", () => {
    const original = makeCollection();
    original.requests[0].requestVars = [
      { key: "page", value: "1", enabled: true },
      { key: "off", value: "x", enabled: false },
    ];
    original.requests[0].responseVars = [{ key: "token", value: "response.json().token" }];
    const imported = importKnockportYaml(serializeCollection(original)) as Collection;
    const r = imported.requests[0];
    expect(r.requestVars).toHaveLength(2);
    expect(r.requestVars?.[0]).toEqual({ key: "page", value: "1" });
    expect(r.requestVars?.[1]).toEqual({ key: "off", value: "x", enabled: false });
    expect(r.responseVars?.[0].key).toBe("token");
    expect(r.responseVars?.[0].value).toBe("response.json().token");
  });

  it("round-trips folder variables (A2)", () => {
    const original = makeCollection();
    original.folders[0].variables = [
      { key: "apiVersion", value: "v2" },
      { key: "legacy", value: "v1", enabled: false },
    ];
    const imported = importKnockportYaml(serializeCollection(original)) as Collection;
    expect(imported.folders[0].variables).toEqual([
      { key: "apiVersion", value: "v2" },
      { key: "legacy", value: "v1", enabled: false },
    ]);
  });

  it("round-trips the full folder settings block (J1)", () => {
    const original = makeCollection();
    original.folders[0].description = "User folder docs";
    original.folders[0].headers = [{ key: "X-Api", value: "v2", enabled: true }];
    original.folders[0].scripts = { pre: "kp.env.set('x','1');" };
    original.folders[0].assertions = [{ expression: "response.status === 200" }];
    original.folders[0].auth = { type: "bearer", bearer: { token: "folder-tok" } };
    const imported = importKnockportYaml(serializeCollection(original)) as Collection;
    const f = imported.folders[0];
    expect(f.description).toBe("User folder docs");
    expect(f.headers).toEqual([{ key: "X-Api", value: "v2", enabled: true }]);
    expect(f.scripts?.pre).toBe("kp.env.set('x','1');");
    expect(f.assertions?.[0].expression).toBe("response.status === 200");
    expect(f.auth?.type).toBe("bearer");
    expect(f.auth?.bearer?.token).toBe("folder-tok");
  });

  it("round-trips collection-level headers (J2)", () => {
    const original = makeCollection();
    original.headers = [
      { key: "X-Collection", value: "one", enabled: true },
      { key: "X-Disabled", value: "off", enabled: false },
    ];
    const imported = importKnockportYaml(serializeCollection(original)) as Collection;
    expect(imported.headers).toEqual([
      { key: "X-Collection", value: "one", enabled: true },
      { key: "X-Disabled", value: "off", enabled: false },
    ]);
  });

  it("byte-stability: serializing twice yields identical output", () => {
    const original = makeCollection();
    expect(serializeCollection(original)).toBe(serializeCollection(original));
  });
});

describe("importAuto fallbacks", () => {
  it("still imports cURL", () => {
    const result = importAuto('curl -X GET "https://api.example.com/users?a=1"') as Request;
    expect(result.method).toBe("GET");
    expect(result.url).toBe("https://api.example.com/users");
  });

  it("still imports HAR", () => {
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://example.com/a", headers: [], queryString: [] },
          },
        ],
      },
    });
    const result = importAuto(har) as Collection;
    expect(result.requests).toHaveLength(1);
  });

  it("still imports Postman v2.1", () => {
    const postman = JSON.stringify({
      info: { name: "PM", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [{ name: "R", request: { method: "GET", url: { raw: "https://x.test/y" } } }],
    });
    const result = importAuto(postman) as Collection;
    expect(result.name).toBe("PM");
    expect(result.requests[0].url).toBe("https://x.test/y");
  });
});

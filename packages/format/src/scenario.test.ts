import { describe, expect, it } from "vitest";
import { scenarioToCollection, type ScenarioJson } from "./scenario";

describe("scenarioToCollection", () => {
  it("maps a flat openapi scenario to a collection of requests", () => {
    const scenario: ScenarioJson = {
      info: { name: "Pets", description: "Pet store API", schema: "https://spec.openapis.org/oas/3.0/schema.json" },
      items: [
        {
          name: "List pets",
          request: {
            url: "https://api.example.com/v1/pets",
            method: "GET",
            headers: [["Accept", "application/json"]],
            query_params: { limit: "10" },
            body: null,
            auth: null,
            follow_redirects: true,
            timeout: null,
            response_type: "text",
          },
          prerequest: [],
          test: [],
          assertions: [],
          items: [],
        },
      ],
      variables: { baseUrl: "https://api.example.com" },
      auth: null,
    };

    const col = scenarioToCollection(scenario);
    expect(col.name).toBe("Pets");
    expect(col.description).toBe("Pet store API");
    expect(col.folders).toEqual([]);
    expect(col.requests).toHaveLength(1);
    expect(col.order).toHaveLength(1);
    const req = col.requests[0];
    expect(req.name).toBe("List pets");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.example.com/v1/pets");
    expect(req.headers).toEqual([{ key: "Accept", value: "application/json", enabled: true }]);
    expect(req.params).toEqual([{ key: "limit", value: "10", enabled: true }]);
    expect(req.body).toEqual({ type: "none" });
    expect(req.auth).toEqual({ type: "none" });
    expect(col.variables).toEqual([{ key: "baseUrl", value: "https://api.example.com", enabled: true }]);
  });

  it("maps nested folders recursively with correct order", () => {
    const scenario = {
      info: { name: "Deep", schema: null },
      items: [
        {
          name: "Users",
          request: null,
          items: [
            { name: "List", request: { url: "https://x/u", method: "GET", headers: [], query_params: {} }, items: [] },
            {
              name: "Sub",
              request: null,
              items: [
                { name: "Detail", request: { url: "https://x/u/1", method: "GET", headers: [], query_params: {} }, items: [] },
              ],
            },
          ],
        },
      ],
      variables: {},
      auth: null,
    };

    const col = scenarioToCollection(scenario);
    expect(col.requests).toEqual([]);
    expect(col.folders).toHaveLength(1);
    expect(col.order).toEqual([col.folders[0].id]);

    const folder = col.folders[0];
    expect(folder.name).toBe("Users");
    expect(folder.requests).toHaveLength(1);
    expect(folder.folders).toHaveLength(1);
    expect(folder.order).toEqual([folder.requests[0].id, folder.folders[0].id]);
    expect(folder.requests[0].name).toBe("List");
    expect(folder.folders[0].name).toBe("Sub");
    expect(folder.folders[0].requests[0].name).toBe("Detail");
  });

  it("maps body variants from the tropel tagged wire format", () => {
    const mk = (body: unknown) =>
      scenarioToCollection({
        info: { name: "B" },
        items: [{ name: "r", request: { url: "u", method: "POST", headers: [], query_params: {}, body: body as never }, items: [] }],
        variables: {},
        auth: null,
      }).requests[0].body;

    expect(mk("{\"a\":1}")).toEqual({ type: "json", content: "{\"a\":1}" });
    expect(mk("plain text")).toEqual({ type: "text", content: "plain text" });
    expect(mk({ a: 1 })).toEqual({ type: "json", content: "{\"a\":1}" });
    expect(
      mk({ __tropel_body: "form_data", fields: [{ name: "f", value: "v" }, { name: "file", filename: "x.png", mime: "image/png" }] }),
    ).toEqual({
      type: "multipart-form",
      formData: [
        { key: "f", value: "v", type: "text", enabled: true },
        { key: "file", value: "x.png", type: "file", enabled: true, contentType: "image/png" },
      ],
    });
    expect(mk({ __tropel_body: "url_encoded", fields: [["a", "1"], ["b", "2"]] })).toEqual({
      type: "form-urlencoded",
      content: "a=1&b=2",
    });
    expect(mk({ __tropel_body: "graphql", query: "q", variables: { x: 1 } })).toEqual({
      type: "graphql",
      graphql: { query: "q", variables: "{\"x\":1}" },
    });
    expect(mk({ __tropel_body: "binary", data: [1, 2] })).toEqual({ type: "binary" });
  });

  it("maps auth configs from the tropel tagged format", () => {
    const mkAuth = (auth: unknown) =>
      scenarioToCollection({
        info: { name: "A" },
        items: [{ name: "r", request: { url: "u", method: "GET", headers: [], query_params: {}, auth: auth as never }, items: [] }],
        variables: {},
        auth: null,
      }).requests[0].auth;

    expect(mkAuth({ type: "bearer", token: "abc" })).toEqual({ type: "bearer", bearer: { token: "abc" } });
    expect(mkAuth({ type: "basic", username: "u", password: "p" })).toEqual({
      type: "basic",
      basic: { username: "u", password: "p" },
    });
    expect(mkAuth({ type: "apikey", key: "X-K", value: "v", location: "header" })).toEqual({
      type: "apiKey",
      apiKey: { key: "X-K", value: "v", in: "header" },
    });
    expect(mkAuth({ type: "apikey", key: "k", value: "v", location: "query" })).toEqual({
      type: "apiKey",
      apiKey: { key: "k", value: "v", in: "query" },
    });
    expect(mkAuth({ type: "oauth1", consumer_key: "ck", consumer_secret: "cs", token: "t", token_secret: "ts" })).toEqual({
      type: "oauth1",
      oauth1: { consumerKey: "ck", consumerSecret: "cs", token: "t", tokenSecret: "ts", signatureMethod: "HMAC-SHA1" },
    });
    expect(mkAuth({ type: "oauth2", access_token: "at", token_type: "Bearer" })).toEqual({
      type: "oauth2",
      oauth2: { grantType: "authorization_code", accessToken: "at", tokenType: "Bearer", sendTokenIn: "header", headerPrefix: "Bearer" },
    });
    expect(
      mkAuth({ type: "aws-sigv4", access_key: "ak", secret_key: "sk", region: "us-east-1", service: "s3" }),
    ).toEqual({
      type: "aws-sigv4",
      awsSigV4: { accessKeyId: "ak", secretAccessKey: "sk", region: "us-east-1", service: "s3" },
    });
    expect(mkAuth({ type: "hawk", auth_id: "id", auth_key: "key" })).toEqual({
      type: "hawk",
      hawk: { id: "id", key: "key", algorithm: "sha256" },
    });
    expect(mkAuth({ type: "noauth" })).toEqual({ type: "none" });
    expect(mkAuth(null)).toEqual({ type: "none" });
  });

  it("maps collection-level auth and rejects invalid methods to GET", () => {
    const col = scenarioToCollection({
      info: { name: "C" },
      items: [{ name: "r", request: { url: "u", method: "PURGE", headers: [], query_params: {} }, items: [] }],
      variables: {},
      auth: { type: "bearer", token: "coll" },
    });
    expect(col.auth).toEqual({ type: "bearer", bearer: { token: "coll" } });
    expect(col.requests[0].method).toBe("GET");
  });

  it("accepts a JSON string document", () => {
    const col = scenarioToCollection(
      JSON.stringify({
        info: { name: "FromString" },
        items: [],
        variables: {},
        auth: null,
      }),
    );
    expect(col.name).toBe("FromString");
    expect(col.requests).toEqual([]);
    expect(col.folders).toEqual([]);
    expect(col.order).toEqual([]);
  });

  it("generates fresh IDs so re-imports never collide", () => {
    const doc = {
      info: { name: "X" },
      items: [{ name: "r", request: { url: "u", method: "GET", headers: [], query_params: {} }, items: [] }],
      variables: {},
      auth: null,
    };
    const a = scenarioToCollection(doc);
    const b = scenarioToCollection(doc);
    expect(a.id).not.toBe(b.id);
    expect(a.requests[0].id).not.toBe(b.requests[0].id);
  });
});
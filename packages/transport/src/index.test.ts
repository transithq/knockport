import { describe, expect, it } from "vitest";
import type { Request } from "@knockport/core";
import { buildBody, buildHeaderList, parseSetCookie, parseSetCookies } from "./index";

describe("parseSetCookie", () => {
  it("parses a minimal cookie", () => {
    const c = parseSetCookie("sid=abc123");
    expect(c).toEqual({ name: "sid", value: "abc123" });
  });

  it("parses all attributes", () => {
    const c = parseSetCookie(
      "id=a3fWa; Domain=example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; HttpOnly; Secure; SameSite=Strict",
    );
    expect(c).toMatchObject({
      name: "id",
      value: "a3fWa",
      domain: "example.com",
      path: "/",
      expires: "Wed, 21 Oct 2026 07:28:00 GMT",
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });
  });

  it("keeps '=' intact inside Expires attribute values", () => {
    const c = parseSetCookie("t=x; Expires=Thu, 01 Jan 2027 00:00:00 GMT");
    expect(c?.expires).toBe("Thu, 01 Jan 2027 00:00:00 GMT");
  });

  it("handles cookie values containing '='", () => {
    const c = parseSetCookie("token=abc=def==; Path=/");
    expect(c).toMatchObject({ name: "token", value: "abc=def==", path: "/" });
  });

  it("handles empty values", () => {
    const c = parseSetCookie("cleared=; Max-Age=0");
    expect(c).toMatchObject({ name: "cleared", value: "", maxAge: 0 });
  });

  it("rejects lines without a name=value pair", () => {
    expect(parseSetCookie("")).toBeNull();
    expect(parseSetCookie("invalid")).toBeNull();
    expect(parseSetCookie("=onlyvalue")).toBeNull();
  });
});

describe("parseSetCookies", () => {
  it("parses one cookie per header value", () => {
    const cookies = parseSetCookies([
      "a=1; HttpOnly",
      "b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure",
    ]);
    expect(cookies).toHaveLength(2);
    expect(cookies[0].name).toBe("a");
    expect(cookies[1].name).toBe("b");
    expect(cookies[1].expires).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
  });
});


// ── GraphQL wire envelope ────────────────────────────────────────────────────
describe("graphql body serialization", () => {
  const gqlRequest: Request = {
    id: "r1",
    name: "q",
    method: "POST",
    url: "https://api.example.com/graphql",
    headers: [],
    params: [],
    body: {
      type: "graphql",
      graphql: { query: "query { user { name } }", variables: "{\"id\": 1}" },
    },
    auth: { type: "none" },
  };

  it("serializes query + parsed variables into the JSON envelope", () => {
    const body = buildBody(gqlRequest);
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toEqual({
      query: "query { user { name } }",
      variables: { id: 1 },
    });
  });

  it("omits variables when empty or invalid", () => {
    const empty = buildBody({ ...gqlRequest, body: { type: "graphql", graphql: { query: "q", variables: "" } } });
    expect(JSON.parse(empty as string)).toEqual({ query: "q" });
    const invalid = buildBody({ ...gqlRequest, body: { type: "graphql", graphql: { query: "q", variables: "not json" } } });
    expect(JSON.parse(invalid as string)).toEqual({ query: "q" });
  });

  it("injects content-type application/json when unset", () => {
    const headers = buildHeaderList(gqlRequest);
    expect(headers).toContainEqual({ key: "Content-Type", value: "application/json" });
  });

  it("never overrides a user-set content-type", () => {
    const headers = buildHeaderList({
      ...gqlRequest,
      headers: [{ key: "content-type", value: "application/graphql", enabled: true }],
    });
    expect(headers).toContainEqual({ key: "content-type", value: "application/graphql" });
    expect(headers.filter((h) => h.key.toLowerCase() === "content-type")).toHaveLength(1);
  });
});

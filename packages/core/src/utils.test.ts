import { describe, expect, it } from "vitest";
import type { Request } from "./types";
import {
  collectPromptVariableNames,
  collectRequestPromptVariables,
  redactVariables,
  resolveVariables,
  scrubRequestSecrets,
  SECRET_MASK,
  secretVariableValues,
  withPromptAnswers,
} from "./utils";

const makeRequest = (): Request => ({
  id: "r1",
  name: "Send",
  method: "POST",
  url: "https://api.test/token?api_key=sk_live_abc123",
  headers: [
    { key: "Authorization", value: "Bearer sk_live_abc123", enabled: true },
    { key: "Accept", value: "application/json", enabled: true },
  ],
  params: [{ key: "api_key", value: "sk_live_abc123", enabled: true }],
  body: { type: "json", content: '{"password":"sk_live_abc123"}' },
  auth: { type: "none" },
});

describe("redactVariables", () => {
  it("masks only non-empty secret values", () => {
    const out = redactVariables([
      { key: "host", value: "api.test", enabled: true },
      { key: "token", value: "sk_live_abc123", type: "secret", enabled: true },
      { key: "empty", value: "", type: "secret", enabled: true },
    ]);
    expect(out[0].value).toBe("api.test");
    expect(out[1].value).toBe(SECRET_MASK);
    expect(out[1].type).toBe("secret");
    expect(out[1].enabled).toBe(true);
    expect(out[2].value).toBe("");
  });
});

describe("secretVariableValues", () => {
  it("collects enabled secret values across sources, deduplicated", () => {
    const values = secretVariableValues(
      [
        { key: "a", value: "s1", type: "secret", enabled: true },
        { key: "b", value: "s2", type: "secret", enabled: false },
        { key: "c", value: "plain", enabled: true },
      ],
      [{ key: "d", value: "s1", type: "secret", enabled: true }],
    );
    expect(values).toEqual(["s1"]);
  });
});

describe("scrubRequestSecrets", () => {
  it("replaces secret values in url, headers, params and body", () => {
    const scrubbed = scrubRequestSecrets(makeRequest(), ["sk_live_abc123"]);
    expect(scrubbed.url).toBe(`https://api.test/token?api_key=${SECRET_MASK}`);
    expect(scrubbed.headers[0].value).toBe(`Bearer ${SECRET_MASK}`);
    expect(scrubbed.headers[1].value).toBe("application/json");
    expect(scrubbed.params[0].value).toBe(SECRET_MASK);
    expect(scrubbed.body.content).toBe(`{"password":"${SECRET_MASK}"}`);
  });

  it("is a no-op for an empty secret list (same object back)", () => {
    const req = makeRequest();
    expect(scrubRequestSecrets(req, [])).toBe(req);
  });
});

describe("prompt variables", () => {
  it("collects distinct $prompt names in first-occurrence order", () => {
    const names = collectPromptVariableNames(
      "https://x/{{$prompt.token}}?a={{$prompt.token}}",
      "head {{$prompt.user}} and {{$prompt.token}} again",
      "",
    );
    expect(names).toEqual(["token", "user"]);
  });

  it("scans url, params, headers, body and scripts of a request", () => {
    const req = makeRequest();
    req.url = "https://x/{{$prompt.fromUrl}}";
    req.headers = [
      { key: "X-T", value: "{{$prompt.fromHeader}}", enabled: true },
      { key: "Authorization", value: "Bearer sk_live_abc123", enabled: true },
      { key: "Accept", value: "application/json", enabled: true },
    ];
    req.body = { type: "json", content: "{{ $prompt.fromBody }}" };
    req.scripts = { pre: "const u = '{{$prompt.fromScript}}';" };
    expect(collectRequestPromptVariables(req)).toEqual([
      "fromUrl",
      "fromHeader",
      "fromBody",
      "fromScript",
    ]);
  });

  it("withPromptAnswers merges under prompt.* and resolveVariables consumes them", () => {
    const vars = withPromptAnswers({ host: "api.test" }, { token: "abc123" });
    expect(vars["prompt.token"]).toBe("abc123");
    const out = resolveVariables("h={{host}} t={{$prompt.token}}", vars);
    expect(out).toBe("h=api.test t=abc123");
  });

  it("unanswered $prompt placeholders survive literal", () => {
    expect(resolveVariables("t={{$prompt.missing}}", {})).toBe("t={{$prompt.missing}}");
  });
});

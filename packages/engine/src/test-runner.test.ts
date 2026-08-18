import type { Request, Response } from "@knockport/core";
import { CookieJar } from "@knockport/core";
import { describe, expect, it } from "vitest";
import {
  mergeTestSummaries,
  runPostResponseScript,
  runPostResponseVars,
  runPreScript,
  runTests,
} from "./test-runner";

function makeRequest(url: string): Request {
  return {
    id: "q1",
    name: "q1",
    method: "GET",
    url,
    headers: [],
    params: [],
    body: { type: "none" },
    auth: { type: "none" },
  };
}

function makeResponse(overrides: Partial<Response> = {}): Response {
  return {
    id: "r1",
    requestId: "q1",
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json", "x-request-id": "abc123" },
    body: JSON.stringify({ data: { id: 7, name: "knockport" }, items: [1, 2, 3] }),
    bodySize: 64,
    timings: { total: 123, ttfb: 50, download: 20 },
    cookies: [{ name: "sid", value: "xyz" }],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("runTests — kp.* (Tropel canonical binding)", () => {
  it("runs kp.test with kp.response.to.have.* (chai-postman chains)", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("Status is 200", () => {
          kp.response.to.have.status(200);
        });
        kp.test("is success", () => {
          kp.response.to.be.success;
        });
        kp.test("Has data", () => {
          const json = kp.response.json();
          kp.expect(json).to.have.property("data");
        });
        kp.test("Header present", () => {
          kp.response.to.have.header("X-Request-Id");
        });
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(4);
  });

  it("kp.expect (pm chain) + chai.expect (full chai shim)", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        const json = kp.response.json();
        kp.test("deep equal", () => kp.expect(json.items).to.eql([1, 2, 3]));
        kp.test("eql (chai)", () => chai.expect(json.data.id).to.eql(7));
        kp.test("include (chai)", () => chai.expect(["knockport", "other"]).to.include("knockport"));
        kp.test("type", () => kp.expect(json.items).to.be.an("array"));
        kp.test("not equal", () => kp.expect(json.data.id).not.to.equal(8));
        kp.test("cookies", () => kp.expect(kp.response.cookies.get("sid")).to.have.property("value", "xyz"));
      `,
    });
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(6);
  });

  it("records failing tests with error suffix", async () => {
    const s = await runTests(makeResponse(), {
      script: `kp.test("is 404", () => { kp.expect(kp.response.code).to.equal(404); });`,
    });
    expect(s.failed).toBe(1);
    expect(s.tests[0].name).toContain("is 404");
  });

  it("unknown assertion property throws instead of silently passing", async () => {
    const s = await runTests(makeResponse(), {
      script: `kp.test("bogus", () => { kp.expect(1).to.be.bogus; });`,
    });
    expect(s.failed).toBe(1);
    expect(s.tests[0].name).toContain("(error)");
  });
});

describe("runTests — pm.* compat", () => {
  it("pm.test / pm.response.code / pm.environment", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        pm.test("code 200", () => {
          pm.expect(pm.response.code).to.eql(200);
        });
        pm.test("json body", () => {
          pm.expect(pm.response.json().data.id).to.eql(7);
        });
        pm.test("env var", () => {
          pm.expect(pm.environment.get("host")).to.eql("api.example.com");
        });
      `,
      environment: { host: "api.example.com" },
    });
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(3);
  });
});

describe("runTests — bru.* compat", () => {
  it("bru.getEnvVar and bru response helpers", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("env visible", () => {
          kp.expect(bru.getEnvVar("host")).to.equal("api.example.com");
        });
        kp.test("status", () => {
          // Bruno's res.getStatus() is the status TEXT; the numeric code is bru.getResStatus()
          kp.expect(res.getStatus()).to.equal("OK");
        });
      `,
      environment: { host: "api.example.com" },
    });
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(2);
  });
});

describe("runTests — declarative assertions", () => {
  it("evaluates expressions with kp/response in scope", async () => {
    const s = await runTests(makeResponse(), {
      assertions: [
        { expression: "response.status === 200", description: "status ok" },
        { expression: "response.json().data.id === 7" },
        { expression: "kp.response.code === 500", description: "should fail" },
        { expression: "response.status === 0 &&", description: "syntax error" },
      ],
    });
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(2);
    expect(s.tests[2].name).toBe("should fail");
    expect(s.tests[3].message).toBeDefined();
  });
});

describe("runTests — error handling", () => {
  it("captures script syntax errors without throwing", async () => {
    const s = await runTests(makeResponse(), { script: "this is not valid js }{" });
    expect(s.scriptError).toBeDefined();
  });

  it("reports json() parse errors as test failures", async () => {
    const s = await runTests(makeResponse({ body: "not json" }), {
      script: `kp.test("parse", () => kp.response.json());`,
    });
    expect(s.failed).toBe(1);
  });

  it("no tests defined yields empty summary", async () => {
    const s = await runTests(makeResponse(), {});
    expect(s.tests).toHaveLength(0);
    expect(s.scriptError).toBeUndefined();
  });
});

describe("runPreScript", () => {
  it("sets runtime variables via kp.env / pm.variables", () => {
    const r = runPreScript(`kp.env.set("token", "abc" + 123);`, { base: "x" });
    expect(r.error).toBeUndefined();
    expect(r.variables.token).toBe("abc123");
    expect(r.variables.base).toBe("x");
  });

  it("reads environment variables", () => {
    const r = runPreScript(
      `kp.env.set("host", pm.environment.get("host"));`,
      {},
      { environment: { host: "example.org" } },
    );
    expect(r.variables.host).toBe("example.org");
  });

  it("captures errors", () => {
    const r = runPreScript(`throw new Error("boom");`, {});
    expect(r.error).toBe("boom");
  });
});

describe("runPostResponseScript", () => {
  it("has full kp.response access and records tests", async () => {
    const r = await runPostResponseScript(
      makeResponse(),
      `kp.test("code is 200", () => kp.expect(kp.response.code).to.eql(200));`,
      {},
    );
    expect(r.summary.failed).toBe(0);
    expect(r.summary.passed).toBe(1);
  });

  it("extracts a response value into runtime variables", async () => {
    const r = await runPostResponseScript(
      makeResponse(),
      `kp.variables.set("dataName", kp.response.json().data.name);`,
      { base: "x" },
    );
    expect(r.summary.scriptError).toBeUndefined();
    expect(r.variables.dataName).toBe("knockport");
    expect(r.variables.base).toBe("x");
  });

  it("reads environment variables", async () => {
    const r = await runPostResponseScript(
      makeResponse(),
      `kp.variables.set("host", kp.environment.get("host"));`,
      {},
      { environment: { host: "example.org" } },
    );
    expect(r.variables.host).toBe("example.org");
  });

  it("captures script errors without throwing", async () => {
    const r = await runPostResponseScript(makeResponse(), `throw new Error("post boom");`, {});
    expect(r.summary.scriptError).toBe("post boom");
    expect(r.summary.failed).toBe(0);
  });

  it("empty script yields an empty summary", async () => {
    const r = await runPostResponseScript(makeResponse(), "   ", {});
    expect(r.summary.tests).toHaveLength(0);
    expect(r.summary.scriptError).toBeUndefined();
  });
});

describe("mergeTestSummaries", () => {
  it("combines counts and flags a script error from either side", () => {
    const a = { tests: [{ name: "a", passed: true }], passed: 1, failed: 0, duration: 1 };
    const b = {
      tests: [{ name: "b", passed: false, message: "x" }],
      passed: 0,
      failed: 1,
      duration: 2,
      scriptError: "err",
    };
    const m = mergeTestSummaries(a, b as any);
    expect(m.tests).toHaveLength(2);
    expect(m.passed).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.scriptError).toBe("err");
  });
});

describe("runPostResponseVars (A1 res side)", () => {
  const vars = [
    { key: "dataName", value: "response.json().data.name" },
    { key: "reqId", value: "res.getHeader('x-request-id')" },
    { key: "status", value: "response.status" },
  ];

  it("evaluates each expression against the response", () => {
    const r = runPostResponseVars(makeResponse(), vars, {});
    expect(r.vars.dataName).toBe("knockport");
    expect(r.vars.reqId).toBe("abc123");
    expect(r.vars.status).toBe("200");
    expect(r.errors).toEqual({});
  });

  it("JSON-encodes object results", () => {
    const r = runPostResponseVars(
      makeResponse(),
      [{ key: "data", value: "JSON.parse(res.getBody()).data" }],
      {},
    );
    expect(r.vars.data).toBe(JSON.stringify({ id: 7, name: "knockport" }));
  });

  it("seeds the runtime scope and keeps unrelated seed values", () => {
    const r = runPostResponseVars(makeResponse(), vars, { seed: "kept" });
    expect(r.vars.seed).toBe("kept");
  });

  it("skips disabled variables and collects per-variable errors", () => {
    const r = runPostResponseVars(makeResponse(), [
      { key: "bad", value: "this is not valid js {{{" },
      { key: "off", value: "res.getStatus()", enabled: false },
    ]);
    expect(r.vars.off).toBeUndefined();
    expect(r.vars.bad).toBeUndefined();
    expect(Object.keys(r.errors)).toEqual(["bad"]);
  });

  it("an empty variable list is a no-op", () => {
    const r = runPostResponseVars(makeResponse(), []);
    expect(r.vars).toEqual({});
    expect(r.errors).toEqual({});
  });
});

describe("runTests — runtime variable visibility (A1)", () => {
  it("exposes provided variables through kp.variables", async () => {
    const s = await runTests(makeResponse(), {
      script: `kp.test("var visible", () => kp.expect(kp.variables.get("dataName")).to.eql("knockport"));`,
      variables: { dataName: "knockport" },
    });
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(1);
  });
});

describe("bru utility API (C9)", () => {
  it("bru.getEnvName + bru.getCollectionName come from the host options", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("env name", () => kp.expect(bru.getEnvName()).to.eql("Staging"));
        kp.test("collection name", () => kp.expect(bru.getCollectionName()).to.eql("Disk API"));
      `,
      envName: "Staging",
      collectionName: "Disk API",
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(2);
  });

  it("names default to null without host options", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("env null", () => kp.expect(bru.getEnvName()).to.eql(null));
        kp.test("col null", () => kp.expect(bru.getCollectionName()).to.eql(null));
      `,
    });
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(2);
  });

  it("bru.utils.minifyJson compacts strings and objects (Bruno semantics)", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("minify string", () => kp.expect(bru.utils.minifyJson('{ "a" : 1 , "b": [1,2] }')).to.eql('{"a":1,"b":[1,2]}'));
        kp.test("minify object", () => kp.expect(bru.utils.minifyJson({ a: 1 })).to.eql('{"a":1}'));
        kp.test("minify empty string", () => kp.expect(bru.utils.minifyJson("   ")).to.eql(""));
        kp.test("minify bad json throws", () => {
          let threw = false;
          try { bru.utils.minifyJson("{ bad"); } catch (e) { threw = true; }
          kp.expect(threw).to.eql(true);
        });
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(4);
  });

  it("bru.utils.minifyXml collapses whitespace and rejects non-strings", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("minify xml", () => kp.expect(bru.utils.minifyXml('<root>\\n  <a>1</a>\\n</root>').indexOf('\\n') === -1).to.eql(true));
        kp.test("minify xml round-trips content", () => kp.expect(bru.utils.minifyXml('<root><a>1</a></root>')).to.include('<a>1</a>'));
        kp.test("non-string throws", () => {
          let threw = false;
          try { bru.utils.minifyXml({ not: "xml" }); } catch (e) { threw = true; }
          kp.expect(threw).to.eql(true);
        });
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(3);
  });

  it("bru.sleep pauses the script (host-side bridge)", async () => {
    const s = await runTests(makeResponse(), {
      script: `
        kp.test("slept at least 60ms", () => {
          const start = Date.now();
          bru.sleep(60);
          const elapsed = Date.now() - start;
          kp.expect(elapsed >= 55).to.eql(true);
        });
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(1);
  });
});

describe("bru.cookies (C8)", () => {
  it("reads cookies scoped to the executing request URL", async () => {
    const jar = new CookieJar();
    jar.upsert("https://api.example.com/things", { key: "session", value: "s1", path: "/" });
    jar.upsert("https://other.example.com/", { key: "session", value: "other", path: "/" });
    const s = await runTests(makeResponse(), {
      request: makeRequest("https://api.example.com/things"),
      cookieJar: jar,
      script: `
        kp.test("get returns value", () => kp.expect(bru.cookies.get("session")).to.eql("s1"));
        kp.test("one returns cookie", () => kp.expect(bru.cookies.one("session").value).to.eql("s1"));
        kp.test("has by name", () => kp.expect(bru.cookies.has("session")).to.eql(true));
        kp.test("scoped count", () => kp.expect(bru.cookies.count()).to.eql(1));
        kp.test("toObject", () => kp.expect(bru.cookies.toObject().session).to.eql("s1"));
        kp.test("toString", () => kp.expect(bru.cookies.toString()).to.eql("session=s1"));
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(6);
  });

  it("writes cookies through add/upsert and reads them back (pre-request)", () => {
    const jar = new CookieJar();
    const result = runPreScript(
      `
        bru.cookies.add({ key: "theme", value: "dark", path: "/" });
        bru.cookies.upsert({ key: "theme", value: "dark2", path: "/" });
      `,
      {},
      { request: makeRequest("https://api.example.com/things"), cookieJar: jar },
    );
    expect(result.error).toBeUndefined();
    const stored = jar.cookiesFor("https://api.example.com/things");
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toBe("theme");
    expect(stored[0].value).toBe("dark2");
  });

  it("delete/remove and clear scoped to the URL", async () => {
    const jar = new CookieJar();
    jar.upsert("https://api.example.com/a", { key: "one", value: "1", path: "/" });
    jar.upsert("https://api.example.com/a", { key: "two", value: "2", path: "/" });
    jar.upsert("https://keep.example.com/", { key: "one", value: "1", path: "/" });
    const s = await runTests(makeResponse(), {
      request: makeRequest("https://api.example.com/a"),
      cookieJar: jar,
      script: `
        bru.cookies.delete("one");
        kp.test("delete removes by name", () => kp.expect(bru.cookies.has("one")).to.eql(false));
        kp.test("other cookie survives", () => kp.expect(bru.cookies.has("two")).to.eql(true));
        bru.cookies.clear();
        kp.test("clear empties scope", () => kp.expect(bru.cookies.count()).to.eql(0));
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(3);
    expect(jar.cookiesFor("https://keep.example.com/")).toHaveLength(1);
  });

  it("jar() handle operates on arbitrary interpolated URLs", async () => {
    const jar = new CookieJar();
    const s = await runTests(makeResponse(), {
      request: makeRequest("https://api.example.com/things"),
      variables: { host: JSON.stringify("api.example.com") },
      cookieJar: jar,
      script: `
        bru.cookies.jar().setCookie("https://{{host}}/login", "token", "abc");
        kp.test("jar setCookie writes", () => kp.expect(bru.cookies.jar().getCookie("https://api.example.com/login", "token").value).to.eql("abc"));
        kp.test("jar hasCookie", () => kp.expect(bru.cookies.jar().hasCookie("https://api.example.com/login", "token")).to.eql(true));
        kp.test("jar deleteCookie", () => {
          bru.cookies.jar().deleteCookie("https://api.example.com/login", "token");
          kp.expect(bru.cookies.jar().hasCookie("https://api.example.com/login", "token")).to.eql(false);
        });
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(3);
  });

  it("reads and writes stay isolated without a jar (no-ops, empty list)", async () => {
    const s = await runTests(makeResponse(), {
      request: makeRequest("https://api.example.com/a"),
      script: `
        kp.test("no jar yields empty list", () => kp.expect(bru.cookies.count()).to.eql(0));
        kp.test("no jar get is undefined", () => kp.expect(bru.cookies.get("x")).to.eql(undefined));
        bru.cookies.add({ key: "x", value: "y" });
        kp.test("no jar add is a no-op", () => kp.expect(bru.cookies.count()).to.eql(0));
      `,
    });
    expect(s.scriptError).toBeUndefined();
    expect(s.failed).toBe(0);
    expect(s.passed).toBe(3);
  });
});

import type { Response } from "@knockport/core";
import { describe, expect, it } from "vitest";
import { mergeTestSummaries, runPostResponseScript, runPreScript, runTests } from "./test-runner";

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

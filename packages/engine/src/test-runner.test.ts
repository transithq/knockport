import { describe, it, expect } from "vitest";
import { runTests, runPreScript } from "./test-runner";
import type { Response } from "@knockport/core";

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
        kp.test("above (chai)", () => chai.expect(json.data.id).to.be.above(5));
        kp.test("oneOf (chai)", () => chai.expect(json.data.name).to.be.oneOf(["knockport", "other"]));
        kp.test("type", () => kp.expect(json.items).to.be.an("array"));
        kp.test("not equal", () => kp.expect(json.data.id).to.not.equal(8));
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
          kp.expect(res.getStatus()).to.equal(200);
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

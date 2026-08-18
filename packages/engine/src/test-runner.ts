/**
 * Interim script runner: hosts the REAL Tropel scripting shims
 * (@tropel/shims — the published bundle of the same sources the tropel
 * runtime embeds) over a TS-implemented `__tropel_pm_*` bridge.
 *
 * Scripts written against kp.* / pm.* / bru.* / chai today are byte-
 * compatible with the M3 wasm runtime, which runs the very same shim
 * files over Rust bridges. Until then this runs in the page JS engine
 * via `new Function` — NOT a security sandbox (user's own scripts, own
 * browser); true isolation arrives with QuickJS wasm in M3.
 */
import type { Assertion, Request, Response, ResponseVariable } from "@knockport/core";
import { defaultBundle, render } from "@tropel/shims";
import xmlFormat from "xml-formatter";

// Subset of the engine's ShimBundle::default() — pm/chai/bru only; the
// lodash/cryptojs/exec shims need bridges KnockPort doesn't host yet.
// Filter preserves the canonical bundle order (pm → chai → … → bru).
const SHIM_SOURCE = render(
  defaultBundle.filter(
    (s) => s.name === "pm-shim" || s.name === "chai-shim" || s.name === "bru-shim",
  ),
);

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface TestRunSummary {
  tests: TestResult[];
  passed: number;
  failed: number;
  duration: number;
  scriptError?: string;
}

export interface PreScriptResult {
  variables: Record<string, string>;
  error?: string;
}

export interface RunTestsOptions {
  script?: string;
  assertions?: Assertion[];
  /** Environment-scoped variables (pm.environment.*). */
  environment?: Record<string, string>;
  /** Collection-scoped variables (pm.collectionVariables.*). */
  collectionVariables?: Record<string, string>;
  /** Global-scoped variables (pm.globals.*). */
  globals?: Record<string, string>;
  /** Runtime variables (pm.variables.* / kp.variables.*) visible to the script. */
  variables?: Record<string, string>;
  /** The resolved request (pm.request.*). */
  request?: Request;
  /** Name of the executing environment (bru.getEnvName()). */
  envName?: string;
  /** Name of the collection the request lives in (bru.getCollectionName()). */
  collectionName?: string;
}

// ── Host state ───────────────────────────────────────────────────────────────
interface Host {
  response?: Response;
  request?: Request;
  /** Runtime variable store (pm.variables.*) — values JSON-encoded per pm.js. */
  vars: Record<string, string>;
  env: Record<string, string>;
  colVars: Record<string, string>;
  globals: Record<string, string>;
  /** Executing environment name (bru.getEnvName(), C9). */
  envName?: string;
  /** Collection name the request lives in (bru.getCollectionName(), C9). */
  collectionName?: string;
}

function headerLookup(headers: Record<string, string>, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function requestHeadersMap(request?: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of request?.headers ?? []) {
    if (h.enabled) out[h.key] = h.value;
  }
  return out;
}

// ── bru.utils helpers (C9) — minifyJson / minifyXml ──────────────────────────
// Faithful ports of Bruno's `bru.utils` (bruno-js/src/bru.js). minifyXml runs
// through xml-formatter, the same library Bruno uses.
function minifyJson(json: unknown): string {
  if (json === null || json === undefined) {
    throw new Error("Failed to minify");
  }
  if (typeof json === "object") {
    try {
      return JSON.stringify(json);
    } catch (err) {
      throw new Error(`Failed to minify: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (typeof json === "string") {
    const trimmed = json.trim();
    if (trimmed === "") return trimmed;
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch (err) {
      throw new Error(`Failed to minify: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new TypeError("minifyJson expects a string or object");
}

function minifyXml(xml: unknown): string {
  if (xml === null || xml === undefined) {
    throw new Error("Failed to minify");
  }
  if (typeof xml === "string") {
    try {
      return xmlFormat.minify(xml, { collapseContent: false });
    } catch (err) {
      throw new Error(`Failed to minify: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new TypeError("minifyXml expects a string");
}

function buildBridges(host: Host, tests: TestResult[]): Record<string, (...args: any[]) => any> {
  const r = () => host.response;
  return {
    // Test recording (pm.test / bru.test funnel here)
    __tropel_pm_test: (name: string, passed: boolean) => {
      tests.push({ name, passed: Boolean(passed) });
    },
    __tropel_pm_test_skip: (name: string) => {
      tests.push({ name, passed: true, message: "skipped" });
    },
    __tropel_pm_group_start: () => {},
    __tropel_pm_group_end: () => {},
    // Declarative assertion recording (KnockPort host-internal)
    __kp_assertion: (name: string, passed: boolean, message?: string) => {
      tests.push({ name, passed: Boolean(passed), message });
    },
    __kp_response: () => {
      const res = r();
      return {
        status: res?.status ?? 0,
        statusText: res?.statusText ?? "",
        headers: res?.headers ?? {},
        body: res?.body ?? "",
        responseTime: res?.timings.total ?? 0,
        size: res?.bodySize ?? 0,
        cookies: res?.cookies ?? [],
        text: () => res?.body ?? "",
        json: () => JSON.parse(res?.body ?? ""),
      };
    },
    // Variable stores
    __tropel_pm_variables_get: (k: string) => host.vars[k] ?? null,
    __tropel_pm_variables_set: (k: string, v: string) => {
      host.vars[k] = String(v);
    },
    __tropel_pm_variables_unset: (k: string) => {
      delete host.vars[k];
    },
    __tropel_pm_environment_get: (k: string) => host.env[k] ?? null,
    __tropel_pm_environment_set: (k: string, v: string) => {
      host.env[k] = String(v);
    },
    __tropel_pm_environment_has: (k: string) => k in host.env,
    __tropel_pm_environment_unset: (k: string) => {
      delete host.env[k];
    },
    __tropel_pm_environment_clear: () => {
      for (const k of Object.keys(host.env)) delete host.env[k];
    },
    __tropel_pm_environment_to_object: () => ({ ...host.env }),
    __tropel_pm_collection_vars_get: (k: string) => host.colVars[k] ?? null,
    __tropel_pm_collection_vars_set: (k: string, v: string) => {
      host.colVars[k] = String(v);
    },
    __tropel_pm_collection_vars_has: (k: string) => k in host.colVars,
    __tropel_pm_collection_vars_unset: (k: string) => {
      delete host.colVars[k];
    },
    __tropel_pm_collection_vars_to_object: () => ({ ...host.colVars }),
    __tropel_pm_globals_get: (k: string) => host.globals[k] ?? null,
    __tropel_pm_globals_set: (k: string, v: string) => {
      host.globals[k] = String(v);
    },
    __tropel_pm_globals_has: (k: string) => k in host.globals,
    __tropel_pm_globals_unset: (k: string) => {
      delete host.globals[k];
    },
    __tropel_pm_globals_to_object: () => ({ ...host.globals }),
    // Response accessors
    __tropel_pm_response_code: () => r()?.status ?? 0,
    __tropel_pm_response_status: () => r()?.statusText ?? "",
    __tropel_pm_response_time: () => r()?.timings.total ?? 0,
    __tropel_pm_response_headers: () => r()?.headers ?? {},
    __tropel_pm_response_header: (k: string) => headerLookup(r()?.headers ?? {}, k) ?? null,
    __tropel_pm_response_body: () => r()?.body ?? "",
    __tropel_pm_response_json: () => {
      const body = r()?.body;
      if (!body) return "";
      try {
        JSON.parse(body);
        return body;
      } catch {
        return "";
      }
    },
    __tropel_pm_response_cookies: () => {
      const map: Record<string, string> = {};
      for (const c of r()?.cookies ?? []) map[c.name] = c.value;
      return map;
    },
    // Request accessors (pre-request scripts)
    __tropel_pm_request_url: () => host.request?.url ?? "",
    __tropel_pm_request_method: () => host.request?.method ?? "",
    __tropel_pm_request_headers: () => requestHeadersMap(host.request),
    __tropel_pm_request_header_get: (k: string) =>
      headerLookup(requestHeadersMap(host.request), k) ?? null,
    __tropel_pm_request_body: () =>
      host.request?.body &&
      "content" in host.request.body &&
      typeof host.request.body.content === "string"
        ? host.request.body.content
        : "",
    // ── bru utility API (C9) ──────────────────────────────────────────────
    // Environment / collection names (bru.getEnvName / bru.getCollectionName).
    // The frozen bru-shim stubs getEnvName() → null; the real values come from
    // the host, which knows the executing environment + owning collection.
    __tropel_env_name: () => host.envName ?? null,
    __tropel_collection_name: () => host.collectionName ?? null,
    // bru.utils.minifyJson / minifyXml (faithful ports of Bruno's bru.utils).
    __tropel_minify_json: (j: unknown) => minifyJson(j),
    __tropel_minify_xml: (x: unknown) => minifyXml(x),
    // bru.sleep / k6 sleep() native bridge. The shims are synchronous
    // (QuickJS-era); in the browser a real blocking sleep is Atomics.wait on a
    // SharedArrayBuffer (no busy-wait), with a busy-wait fallback where SAB is
    // unavailable (no cross-origin isolation).
    __tropel_native_sleep: (ms: number) => {
      if (typeof ms !== "number" || !(ms > 0)) return;
      const wait = Math.floor(ms);
      if (typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
        return;
      }
      const end = Date.now() + wait;
      while (Date.now() < end) {
        // busy-wait fallback
      }
    },
  };
}

// ── Realm factory (compiled once) ────────────────────────────────────────────
// The prelude evals the @tropel/shims sources inside a function scope whose
// `globalThis` parameter is a per-run sandbox object, then hands back a
// runner that direct-evals user code in that same scope (kp/pm/bru/chai
// all in scope).
const PRELUDE_TRAILER = `
;var kp = globalThis.kp, trp = globalThis.trp, pm = globalThis.pm,
   bru = globalThis.bru, req = globalThis.req, res = globalThis.res;
kp.env = {
  get: function (k) { return kp.variables.get(k); },
  set: function (k, v) { kp.variables.set(k, v); }
};
/* C9 — bru utility API: host-side glue over the frozen bru-shim. The shim
   ships a null getEnvName stub and no getCollectionName/utils; the real
   values live in the KnockPort host (executing env name, owning collection),
   so we patch the object properties here (the global binding stays
   read-only, the object itself is mutable). */
bru.getEnvName = function () { return __tropel_env_name(); };
bru.getCollectionName = function () { return __tropel_collection_name(); };
bru.utils = {
  minifyJson: function (j) { return __tropel_minify_json(j); },
  minifyXml: function (x) { return __tropel_minify_xml(x); }
};
var response = __kp_response();
return function (__kp_script) { return eval(__kp_script); };
`;

let realmFactory: ((...args: unknown[]) => (script: string) => unknown) | undefined;

function getRealmFactory() {
  if (!realmFactory) {
    const bridgeNames = Object.keys(buildBridges(emptyHost(), []));
    realmFactory = new Function(
      "globalThis",
      "__tropel_sandbox_config",
      ...bridgeNames,
      SHIM_SOURCE + "\n" + PRELUDE_TRAILER,
    ) as (...args: unknown[]) => (script: string) => unknown;
  }
  return realmFactory;
}

function emptyHost(): Host {
  return { vars: {}, env: {}, colVars: {}, globals: {} };
}

interface Realm {
  run: (script: string) => unknown;
  host: Host;
}

function createRealm(
  opts: RunTestsOptions,
  tests: TestResult[],
  variables: Record<string, string>,
): Realm {
  const host: Host = {
    vars: { ...variables },
    env: { ...(opts.environment ?? {}) },
    colVars: { ...(opts.collectionVariables ?? {}) },
    globals: { ...(opts.globals ?? {}) },
    envName: opts.envName,
    collectionName: opts.collectionName,
    response: undefined,
    request: opts.request,
  };
  return createRealmWithHost(host, tests);
}

function createRealmWithHost(host: Host, tests: TestResult[]): Realm {
  const bridges = buildBridges(host, tests);
  // The shims read some bridges as bare identifiers and others via
  // `globalThis.__tropel_pm_*` (pm.response value getters) — install both.
  const sandbox: Record<string, unknown> = { console, ...bridges };
  const factory = getRealmFactory();
  const run = factory(sandbox, { namespace: "kp", aliases: [] }, ...Object.values(bridges));
  return { run, host };
}

// Loop appended to user scripts: evaluates declarative assertions via
// direct eval (kp/pm/response all in scope) and records each through
// the __kp_assertion bridge.
const ASSERTION_LOOP = `
;(function () {
  if (typeof __kp_assertions === 'undefined' || !__kp_assertions) return;
  for (var __i = 0; __i < __kp_assertions.length; __i++) {
    var __a = __kp_assertions[__i];
    var __name = __a.description || __a.expression;
    var __passed = false, __msg;
    try {
      var __v = eval('(' + __a.expression + ')');
      __passed = __v === true;
      if (!__passed) {
        try { __msg = 'expression returned ' + JSON.stringify(__v); }
        catch (e2) { __msg = 'expression returned ' + String(__v); }
      }
    } catch (e) {
      __msg = e && e.message ? e.message : String(e);
    }
    __kp_assertion(__name, __passed, __msg);
  }
})();
`;

function assertionPreamble(assertions: Assertion[]): string {
  // The list is passed as a JSON literal — expressions are evaluated at
  // runtime via eval, never string-concatenated into code here.
  return (
    "var __kp_assertions = " +
    JSON.stringify(
      assertions.map((a) => ({ expression: a.expression, description: a.description })),
    ) +
    ";\n"
  );
}

/**
 * Run the test script (if any) and declarative assertions against a response.
 * Never throws — every problem is reported as a failed test or scriptError.
 */
export async function runTests(
  response: Response,
  opts: RunTestsOptions = {},
): Promise<TestRunSummary> {
  const start = performance.now();
  const tests: TestResult[] = [];
  const host = emptyHost();
  host.response = response;
  host.request = opts.request;
  host.env = { ...(opts.environment ?? {}) };
  host.colVars = { ...(opts.collectionVariables ?? {}) };
  host.globals = { ...(opts.globals ?? {}) };
  host.vars = { ...(opts.variables ?? {}) };
  host.envName = opts.envName;
  host.collectionName = opts.collectionName;

  let scriptError: string | undefined;
  const script = opts.script?.trim();
  const assertions = (opts.assertions ?? []).filter((a) => a.expression.trim());

  if (script || assertions.length > 0) {
    const realm = createRealmWithHost(host, tests);
    const code =
      (script ? script + "\n" : "") +
      (assertions.length > 0 ? assertionPreamble(assertions) + ASSERTION_LOOP : "");
    try {
      realm.run(code);
    } catch (e) {
      scriptError = e instanceof Error ? e.message : String(e);
    }
    // Let async pm.test bodies (promise-returning) settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const passed = tests.filter((t) => t.passed).length;
  return {
    tests,
    passed,
    failed: tests.length - passed,
    duration: performance.now() - start,
    scriptError,
  };
}

/**
 * Run a pre-request script. Exposes kp.env.* / pm.* / bru.* for variable
 * capture; returns the mutated runtime variables for {{var}} resolution.
 */
export function runPreScript(
  script: string,
  variables: Record<string, string>,
  opts: RunTestsOptions = {},
): PreScriptResult {
  const trimmed = script.trim();
  if (!trimmed) return { variables: { ...variables } };

  const tests: TestResult[] = [];
  const { host, run } = createRealm(opts, tests, variables);
  try {
    run(trimmed);
  } catch (e) {
    return { variables: decodeVars(host.vars), error: e instanceof Error ? e.message : String(e) };
  }
  return { variables: decodeVars(host.vars) };
}

/** Decode the JSON-encoded pm variable store back to plain strings. */
function decodeVars(store: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(store)) {
    try {
      const v = JSON.parse(raw);
      out[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
    } catch {
      out[k] = raw;
    }
  }
  return out;
}

// ── Post-response scripts ────────────────────────────────────────────────────
/**
 * Result of a post-response script run: mutated runtime variables (carried
 * into the next request in a runner loop) plus the usual test summary
 * (post-response scripts may record kp.test checks too).
 */
export interface PostResponseResult {
  variables: Record<string, string>;
  summary: TestRunSummary;
}

/**
 * Run a post-response script against a response. Has full response access
 * and may record tests; runs AFTER the request, before test scripts (Bruno's
 * script ordering). Returns the mutated runtime variables so callers can
 * carry them into the following request. Never throws.
 */
export async function runPostResponseScript(
  response: Response,
  script: string,
  variables: Record<string, string> = {},
  opts: RunTestsOptions = {},
): Promise<PostResponseResult> {
  const start = performance.now();
  const tests: TestResult[] = [];
  const host = emptyHost();
  host.response = response;
  host.request = opts.request;
  host.vars = { ...variables };
  host.env = { ...(opts.environment ?? {}) };
  host.colVars = { ...(opts.collectionVariables ?? {}) };
  host.globals = { ...(opts.globals ?? {}) };
  host.envName = opts.envName;
  host.collectionName = opts.collectionName;
  const { run } = createRealmWithHost(host, tests);

  let scriptError: string | undefined;
  if (script.trim()) {
    try {
      run(script);
    } catch (e) {
      scriptError = e instanceof Error ? e.message : String(e);
    }
    // Let async kp.test bodies settle (mirrors runTests).
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const passed = tests.filter((t) => t.passed).length;
  return {
    variables: decodeVars(host.vars),
    summary: {
      tests,
      passed,
      failed: tests.length - passed,
      duration: performance.now() - start,
      scriptError,
    },
  };
}

/** Merge two test summaries (post-response + tests) for a single response. */
export function mergeTestSummaries(a: TestRunSummary, b: TestRunSummary): TestRunSummary {
  return {
    tests: [...a.tests, ...b.tests],
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    duration: a.duration + b.duration,
    scriptError: a.scriptError ?? b.scriptError,
  };
}

// ── Post-response variables (vars:post-response) ────────────────────────────
/**
 * Result of evaluating a request's response variables (A1 res side): the
 * computed values merged into the runtime scope, plus a per-variable error
 * report (never throws — Bruno collects errors and surfaces them as a toast).
 */
export interface ResponseVarsResult {
  vars: Record<string, string>;
  errors: Record<string, string>;
}

/**
 * Evaluate each enabled response variable as a JS expression against the
 * response (Bruno's `-vars:post-response` semantics). The result of each
 * expression lands in the runtime variable store for post-response/test
 * scripts and the runner's next request. Non-primitive results are
 * JSON-encoded.
 */
export function runPostResponseVars(
  response: Response,
  variables: ResponseVariable[],
  seed: Record<string, string> = {},
  opts: RunTestsOptions = {},
): ResponseVarsResult {
  const enabled = variables.filter((v) => v.enabled !== false && v.key.trim());
  if (enabled.length === 0) return { vars: {}, errors: {} };

  const tests: TestResult[] = [];
  const host = emptyHost();
  host.response = response;
  host.request = opts.request;
  host.vars = { ...seed };
  host.env = { ...(opts.environment ?? {}) };
  host.colVars = { ...(opts.collectionVariables ?? {}) };
  host.globals = { ...(opts.globals ?? {}) };
  host.envName = opts.envName;
  host.collectionName = opts.collectionName;
  const { run } = createRealmWithHost(host, tests);

  const errors: Record<string, string> = {};
  for (const v of enabled) {
    try {
      const value = run(v.value);
      host.vars[v.key] =
        typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
    } catch (e) {
      errors[v.key] = e instanceof Error ? e.message : String(e);
    }
  }
  return { vars: decodeVars(host.vars), errors };
}

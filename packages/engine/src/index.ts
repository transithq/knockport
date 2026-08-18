/**
 * @knockport/engine
 *
 * Wrapper for @tropel/runtime-wasm (the Tropel execution engine compiled to WASM).
 * This module handles:
 * - Lazy-loading the wasm after first paint
 * - Running the engine in a Web Worker
 * - postcard ABI communication (not JSON)
 * - kp.* alias wiring
 *
 * In M0, this provides the interface. The actual wasm integration lands in M3
 * once @tropel/runtime-wasm is published.
 */

export { runTests, runPreScript, runPostResponseScript, runPostResponseVars, mergeTestSummaries } from "./test-runner";
export type {
  TestResult,
  TestRunSummary,
  RunTestsOptions,
  PreScriptResult,
  PostResponseResult,
  ResponseVarsResult,
} from "./test-runner";

import { runPostResponseScript, runPreScript, runTests } from "./test-runner";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineConfig {
  wasmUrl?: string;
  workerUrl?: string;
  namespace?: string;
}

export interface ScriptExecutionResult {
  success: boolean;
  variables: Record<string, string>;
  assertions: AssertionResult[];
  error?: string;
  duration: number;
}

export interface AssertionResult {
  expression: string;
  passed: boolean;
  message?: string;
}

/**
 * The scripting engine interface.
 * Responsible for executing pre-request and test scripts.
 *
 * In the browser, scripts run in a Web Worker with QuickJS (via tropel wasm).
 * On desktop (Tauri), scripts run in the native tropel-runtime.
 */
export class ScriptEngine {
  private status: EngineStatus = "idle";
  private config: EngineConfig;
  private worker: Worker | undefined;

  constructor(config: EngineConfig = {}) {
    this.config = {
      namespace: "kp",
      ...config,
    };
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getConfig(): EngineConfig {
    return this.config;
  }

  /**
   * Initialize the engine. Call this after first paint to avoid blocking UI.
   */
  async init(): Promise<void> {
    if (this.status === "ready") return;

    this.status = "loading";
    try {
      // M3: Load wasm in a Worker
      // For now, the engine is a stub that uses the browser's JS engine
      this.status = "ready";
    } catch (err) {
      this.status = "error";
      throw err;
    }
  }

  /**
   * Execute a pre-request script.
   */
  async executePreScript(
    script: string,
    variables: Record<string, string>,
    _request: any,
  ): Promise<ScriptExecutionResult> {
    const start = performance.now();
    try {
      const result = runPreScript(script, variables);
      return {
        success: !result.error,
        variables: result.variables,
        assertions: [],
        error: result.error,
        duration: performance.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        variables,
        assertions: [],
        error: err instanceof Error ? err.message : String(err),
        duration: performance.now() - start,
      };
    }
  }

  /**
   * Execute a post-response script against a response.
   */
  async executePostResponseScript(
    response: any,
    script: string,
    variables: Record<string, string> = {},
  ): Promise<ScriptExecutionResult> {
    const start = performance.now();
    try {
      const result = await runPostResponseScript(response, script, variables);
      return {
        success: !result.summary.scriptError && result.summary.failed === 0,
        variables: result.variables,
        assertions: result.summary.tests.map((t) => ({
          expression: t.name,
          passed: t.passed,
          message: t.message,
        })),
        error: result.summary.scriptError,
        duration: performance.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        variables,
        assertions: [],
        error: err instanceof Error ? err.message : String(err),
        duration: performance.now() - start,
      };
    }
  }

  /**
   * Execute a test script.
   */
  async executeTestScript(
    script: string,
    variables: Record<string, string>,
    response: any,
  ): Promise<ScriptExecutionResult> {
    const start = performance.now();
    try {
      const summary = await runTests(response, { script });
      return {
        success: !summary.scriptError && summary.failed === 0,
        variables,
        assertions: summary.tests.map((t) => ({
          expression: t.name,
          passed: t.passed,
          message: t.message,
        })),
        error: summary.scriptError,
        duration: performance.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        variables,
        assertions: [],
        error: err instanceof Error ? err.message : String(err),
        duration: performance.now() - start,
      };
    }
  }

  /**
   * Evaluate declarative assertions against a response.
   */
  evaluateAssertions(assertions: string[], response: any): AssertionResult[] {
    // Fire-and-forget shim: callers that need results should use runTests()
    // directly (async). Kept for interface compatibility.
    const results: AssertionResult[] = [];
    void runTests(response, {
      assertions: assertions.map((expression) => ({ expression })),
    }).then((summary) => {
      results.push(
        ...summary.tests.map((t) => ({ expression: t.name, passed: t.passed, message: t.message })),
      );
    });
    return results;
  }

  /**
   * Dispose the engine and worker.
   */
  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.status = "idle";
  }
}

// Singleton
let engineInstance: ScriptEngine | undefined;

export function getEngine(config?: EngineConfig): ScriptEngine {
  if (!engineInstance) {
    engineInstance = new ScriptEngine(config);
  }
  return engineInstance;
}

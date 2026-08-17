// Dynamic $variable resolution — routed through @tropel/core-wasm (the
// compiled Tropel DynamicCatalog) so the web app, extension and CLI share
// one catalog implementation. The local TS port (./predefinedVariables)
// survives only as the fallback for the pre-init race (first send before
// the ~140 KB wasm finishes loading) and for test/runnable environments
// without WebAssembly. See WEB_EXTENSION_RUNTIME_SPLIT.md: the web app
// never loads the QuickJS tier — this core-wasm module is its only Rust
// payload.

import {
  getPredefinedVariablesMeta as tropelMeta,
  initCoreWasm,
  isCoreWasmReady,
  resolveDynamicVariables as tropelResolve,
} from "@tropel/core-wasm";
import {
  PREDEFINED_VARIABLES as TS_PREDEFINED_VARIABLES,
  resolvePredefinedVariables as tsResolve,
} from "./predefinedVariables.js";

let initPromise: Promise<boolean> | null = null;

/**
 * Kick off (idempotent) core-wasm init. `wasmUrl` (the app's bundled asset
 * URL for tropel_core_wasm_bg.wasm) is captured on the first call; later
 * calls may omit it. Resolves true when the catalog is wasm-backed.
 */
export function ensureTropelCore(wasmUrl?: string | URL): Promise<boolean> {
  initPromise ??= initCoreWasm(wasmUrl === undefined ? {} : { wasmUrl });
  return initPromise;
}

/** True once the wasm catalog is live. */
export function isTropelCoreReady(): boolean {
  return isCoreWasmReady();
}

/**
 * Resolve predefined dynamic variables (`{{$guid}}`, …). Wasm catalog when
 * ready, TS fallback until then — both are 1:1 ports of the same
 * DynamicCatalog, so behaviour never diverges.
 */
export function resolvePredefinedVariables(template: string): string {
  return isCoreWasmReady() ? tropelResolve(template) : tsResolve(template);
}

export interface PredefinedVariableInfo {
  name: string;
  description: string;
}

/** Catalog metadata for editor UIs (synchronous — extracted at package build time). */
export function getPredefinedVariablesMeta(): readonly PredefinedVariableInfo[] {
  try {
    const meta = tropelMeta();
    if (meta.length > 0) return meta;
  } catch {
    // fall through to the TS table
  }
  return TS_PREDEFINED_VARIABLES;
}

/** The `$`-prefixed catalog names (autocomplete lists). */
export function getPredefinedVariableNames(): readonly string[] {
  return getPredefinedVariablesMeta().map((v) => v.name);
}

export { MAX_DYNAMIC_LENGTH } from "./predefinedVariables.js";

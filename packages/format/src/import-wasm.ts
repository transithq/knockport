import type { Collection } from "@knockport/core";
import {
  detect as wasmDetect,
  initInputWasm,
  importAny as wasmImportAny,
  isInputWasmReady,
} from "@tropel/input-wasm";
import { scenarioToCollection } from "./scenario";

// ── Tropel input slice glue ──────────────────────────────────────────────────
// Lazy host for the @tropel/input-wasm collection parsers (OpenAPI 3.x /
// Swagger 2.0, Postman v2.x, HAR). The ~700 KB slice is fetched ONLY when
// this module's init runs — the import modal opens it on demand so the
// eagerly-loaded core tier stays small (API_CLIENT_WEB_PAYLOAD.md §2.3).
// Detection + parse happen in the wasm (tropel's own adapters, not a TS
// port); the returned Scenario JSON maps to a KnockPort Collection here.

let initPromise: Promise<boolean> | null = null;
let registeredUrl: string | URL | undefined;

/**
 * Record the app's bundled wasm asset URL for tropel_input_wasm_bg.wasm.
 * Cheap (no fetch) — apps/web calls this at boot; the fetch happens only
 * when the import UI first opens (see `ensureTropelInput`).
 */
export function registerTropelInputWasmUrl(url: string | URL): void {
  registeredUrl = url;
}

/**
 * Kick off (idempotent) input-wasm init. When called without a URL, uses the
 * URL previously `registerTropelInputWasmUrl`-ed (tests may instead pass
 * `wasmBytes` directly). Resolves true when the slice is wasm-backed.
 */
export function ensureTropelInput(options?: { wasmUrl?: string | URL; wasmBytes?: Uint8Array | ArrayBuffer }): Promise<boolean> {
  initPromise ??= initInputWasm(options ?? (registeredUrl ? { wasmUrl: registeredUrl } : {}));
  return initPromise;
}

/** True once the input wasm is live. */
export function isTropelInputReady(): boolean {
  return isInputWasmReady();
}

export type ImportResult = { format: string; collection: Collection } | null;

/**
 * Import collection bytes through the wasm slice. Returns `null` when the
 * slice isn't ready or the bytes aren't a recognized collection format —
 * callers then fall back to the TS importers (cURL / env / native).
 * Throws when a format IS detected but the parser rejects the content.
 */
export function importAnyAsCollection(bytes: Uint8Array): ImportResult {
  if (!isInputWasmReady()) return null;
  const format = wasmDetect(bytes);
  if (!format) return null;
  const scenarioJson = wasmImportAny(bytes);
  return { format, collection: scenarioToCollection(scenarioJson) };
}
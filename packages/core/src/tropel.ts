// Dynamic $variable resolution — the compiled Tropel DynamicCatalog
// (@tropel/core-wasm, the wasm32 core tier). One catalog implementation for
// the web app, extension and CLI: there is intentionally no TS port. Before
// init resolves (the ~457 KB wasm is lazy-loaded at boot from apps/web) the
// resolver degrades to a passthrough — `{{$…}}` survives literal and the
// embedder's own {{var}} map still resolves on the very first sends.
// See WEB_EXTENSION_RUNTIME_SPLIT.md: the web app never loads the QuickJS
// tier — this core-wasm module is its only Rust payload.

import {
  getPredefinedVariablesMeta as tropelMeta,
  initCoreWasm,
  isCoreWasmReady,
  resolveDynamicVariables as tropelResolve,
} from "@tropel/core-wasm";

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
 * Resolve predefined dynamic variables (`{{$guid}}`, …) — fresh value per
 * occurrence, Tropel semantics. Passthrough (input unchanged) until init.
 */
export function resolvePredefinedVariables(template: string): string {
  return tropelResolve(template);
}

export interface PredefinedVariableInfo {
  name: string;
  description: string;
}

/** Catalog metadata for editor UIs (synchronous — extracted at package build time). */
export function getPredefinedVariablesMeta(): readonly PredefinedVariableInfo[] {
  return tropelMeta();
}

/** The `$`-prefixed catalog names (autocomplete lists). */
export function getPredefinedVariableNames(): readonly string[] {
  return getPredefinedVariablesMeta().map((v) => v.name);
}

/**
 * The catalog's `:length` cap (mirrors Rust `MAX_DYNAMIC_LENGTH` in
 * tropel-variables/src/catalog.rs).
 */
export const MAX_DYNAMIC_LENGTH = 10_000;

// ── OAuth2 / JWT / WSSE (tropel-auth::oauth behind core-wasm) ───────────────
// Re-export the auth building blocks so the UI/engine import them from
// @knockport/core (single import point for the wasm tier). All functions
// throw until `ensureTropelCore()` resolves, EXCEPT oauth2IsTokenExpired
// (pure JS host clock).
export {
  generatePkcePair,
  oauth2AttachToken,
  oauth2BuildAuthorizeUrl,
  oauth2BuildTokenRequest,
  oauth2DecodeJwt,
  oauth2IsTokenExpired,
  oauth2JwtExpiresAt,
  oauth2ParseTokenResponse,
  oauth2SignJwt,
  oauth2StoreToken,
  wsseSign,
} from "@tropel/core-wasm";
export type {
  AuthorizeParams,
  AuthorizeRequest,
  DecodedJwt,
  PkcePair,
  StoredToken,
  TokenAttachment,
  TokenRequest,
  TokenRequestParams,
  TokenResponse,
} from "@tropel/core-wasm";

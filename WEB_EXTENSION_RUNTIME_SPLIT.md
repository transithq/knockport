# KnockPort — Web vs Extension runtime split

> Decision record (2026-08-17). Answers: "does the website need to load
> `tropel-web.wasm`?" — **no.** Only the extension/native surface does.

---

## The two surfaces

| Surface | Transport | Constraint |
|---|---|---|
| **Website / web app** | **Relay only** (like Hoppscotch's `proxyscotch` / Postman Cloud Agent). Browsers block cross-origin `fetch` — the web app cannot hit an API on another port/domain directly without CORS consent, and most real APIs don't send CORS headers. Relay is mandatory. | Page-load weight, first paint |
| **Extension** | **Client-only** — extension contexts have `host_permissions` and bypass CORS entirely; requests fire straight from the browser process, no relay in the loop. | Install size, Web Store review |

Key observation: **CORS is a transport-layer problem, not a compute
problem.** Whatever the surface, the *computation* (variables, scripts,
assertions, auth signing) runs client-side. Only the wire path differs.

---

## What each surface needs from Tropel

| Capability | Website | Extension | Where it lives |
|---|---|---|---|
| HTTP transport | relay proxy | direct `fetch` | `packages/transport` + `apps/relay` |
| Script execution (kp/pm/bru) | browser JS engine (`new Function` over `@tropel/shims`) | same — until true sandboxing (C1/M3) wants QuickJS | `packages/engine` |
| Variable resolution (incl. `$dynamic` catalog) | needed | needed | **`@tropel/core` tier (Rust → wasm32-unknown-unknown)** |
| Auth signing (OAuth2/HMAC/SigV4/Digest) | needed | needed | core tier |
| Declarative assertions + test collection | needed | needed | core tier (or host JS, already works) |
| OpenAPI/Postman/HAR import parse | needed | needed | core tier (`tropel-input-*` adapters) |
| Codegen (httpsnippet matrix) | needed | needed | browser JS later (I1) |
| QuickJS sandboxed script execution | **no** | **yes** (C1) | `tropel-web` (`tropel_web.wasm`, ~2.5 MB) |
| k6-style load runs in-page | no | yes | `tropel-web` |

**The website loads: `@tropel/shims` (JS, already published) + the core-tier
wasm. Zero QuickJS.** This is exactly §3 of `API_CLIENT_WEB_PAYLOAD.md`
("the website runs scripts in the browser's own JS engine … the divergence
is confined to the JavaScript language level"), and it is what KnockPort's
engine already does today — user scripts run in the host engine, not
QuickJS.

**The extension loads: the same, plus `tropel_web.wasm`** — because only
there do we get the payoff worth the bytes:
- true script sandboxing (PARITY_TODO **C1**, QuickJS instead of
  `new Function`);
- the one-engine guarantee between desktop load tests and in-page scripting;
- heavy protocol work (gRPC/protobuf K4, socket transports K1/K5) where a
  native runtime beats JS libraries.

---

## Why `tropel_web.wasm` is the wrong tool for web interpolation anyway

- It is a `wasm32-wasip1` cdylib with a postcard C ABI designed to run whole
  scenarios, and it drags QuickJS (~1–1.5 MB of the 2.5 MB). Downloading it
  to resolve `{{baseUrl}}` is paying for a second JavaScript engine to do
  string replacement.
- The payload doc's §2.3 already prescribes the shape: **two-tier wasm** —
  `core.wasm` (parse · variables · auth · assertions, **no QuickJS**,
  ~300–800 KB, loaded eagerly) and `script.wasm` (QuickJS, loaded only when
  a request has scripts — and for the website, arguably never).
- `tropel-variables` + `tropel-auth` + the parser are host-free crates; they
  compile to `wasm32-unknown-unknown` directly. Each capability we need on
  the web becomes a thin `wasm-bindgen` export in the core tier instead of a
  TypeScript re-implementation — one source of truth, no drift.

---

## Build plan flowing from this split

1. **`crates/tropel-core-wasm`** — the core tier. Starts with
   `resolve_variables` (the `DynamicCatalog`) + variable metadata for editor
   autocomplete; later: auth signing, OpenAPI/Postman import, assertions.
   `wasm-pack` → `wasm32-unknown-unknown`, target ≤ ~200 KB raw for the
   variables-only slice (regex crate dominates; acceptable, brotli-friendly).
2. **`packages/core-wasm` → `@tropel/core-wasm`** npm package (same shape as
   `@tropel/runtime-wasm`: wasm artifact + TS glue, `sideEffects: false`).
3. **KnockPort consumes `@tropel/core-wasm`**: facade in
   `packages/core` with a sync TS fallback until wasm init lands (init at
   app boot, lazy-resolving promises at the two interpolation chokepoints).
   Website payload: shims JS + core wasm only.
4. **Extension phase (M7+)** adds `@tropel/runtime-wasm` for the QuickJS
   sandbox, load runs, and protocol workspaces — never loaded on the
   website.

## Why not run EVERYTHING on the relay? (execution offloading)

The tempting variant: the website sends the *unresolved* request — URL with
`{{vars}}`, scripts, auth config, environment — to the relay, the relay runs
native Tropel over it and returns the final response + test results. One
runtime across all platforms, and the web page loads **nothing** (not even
`@tropel/shims` or the core wasm) except editor metadata for autocomplete.

This is exactly Postman's Cloud Agent. It is technically clean and the
one-engine motto does hold — the Rust engine runs somewhere for every
surface (embedded on extension/native, server-side on web). The problems
are elsewhere:

1. **We become custodians of customer secrets.** Execution offloading means
   env vars, API keys, collections and script source all transit our server
   on every request. `API_CLIENT_WEB_PAYLOAD.md §1` is explicit: "*Do not do
   the second. You become custodians of customer secrets.*" A proxy-only
   relay (Hoppscotch's `proxyscotch` model, ours today) only sees the final
   resolved request — the relay-execution model sees everything, always.
2. **Offline dies, availability couples to the relay.** Client-side execution
   keeps the app usable whenever the relay is up for transport only;
   relay-execution makes the relay the app's brain — every outage, latency
   spike, and deploy becomes a full app outage.
3. **Self-hosted relays become heavy trust boundaries.** `apps/relay` today
   is a dumb CORS proxy anyone can run anywhere. Turning it into an
   execution engine means every self-host asks that host to be trusted with
   every secret the workspace touches.

Where relay execution IS the right shape: **collection runner / load runs
(M5, D-block)**. A batch of N iterations over one connection, with carry-over
variables and aggregated results, is Tropel's native home turf — and
Postman sells exactly this as a cloud product. That makes the correct split:

| Flow | Where it executes | Why |
|---|---|---|
| Interactive send (edit/Send loop) | client (shims + core wasm) | secrets stay local, one CORS hop, offline-friendly |
| Collection runner / load run | **optional relay execution** via native Tropel | batch semantics, one connection, premium tier |
| Codegen / autocomplete / UI | client, pure JS/metadata | never needs execution |

Decision: interactive requests stay client-executed on the website (relay =
transport proxy only). Server-side execution is deferred to the runner
offload feature, where the privacy trade is a visible, opt-in product choice
instead of an invisible default on every Send.

## Decision log

- Variables (A4) ship via the core tier — no TypeScript re-implementation
  kept as primary (the local port is deleted once the facade is wired).
- The `tropel-web` (wasip1) slice stays extension/native-only; KnockPort's
  web app never fetches it.
- Relay remains the web transport story; the split is transport-only,
  so scripting/variable behaviour stays identical across surfaces — same
  `@tropel/shims`, same Rust catalog.

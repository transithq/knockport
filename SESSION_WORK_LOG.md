# Session Log — Tropel core-wasm tier & KnockPort A4 integration

**Date:** 2026-08-17
**Repos:** `D:\tropel` (engine monorepo) · `D:\knockport` (API client)
**Goal:** Implement PARITY_TODO parity items **one by one, commit after each item**,
reusing Tropel's Rust implementations instead of rewriting in TypeScript,
while keeping KnockPort lightweight and fast.

---

## 0 · Ground rules set at the start

1. Follow `PARITY_TODO.md` execution order (Phase 1 → 7), one commit per item.
2. Never write "AI"/"AI agent" in commit messages.
3. `.gitignore` changes stay uncommitted for now.
4. Before writing TS, check whether Tropel already implements it and reuse if
   that is faster/lighter ("do not reimplement").
5. Website vs extension split: the web app goes through a **relay** (CORS) and
   never loads the QuickJS tier; only the extension needs `tropel_web.wasm`.

## 1 · Discovery (before the first line of code)

- KnockPort state: clean tree; last commits `add7069` (relay → tropel-http swap),
  `c0bd938`, `3ddc4c8`, `781ceb5`.
- Sub-agent map of KnockPort's variable system:
  - types `Variable`/`Environment` in `packages/core/src/types.ts:225–238`
    (`type: "secret"` already exists; `"globals"` scope token exists but dead).
  - resolver `resolveVariables` at `packages/core/src/utils.ts:36` — regex
    `[\w.]+` **rejects `$`**, so `{{$guid}}` never matched.
  - scope merge `buildVariableMap` at `packages/ui/src/store/variables.ts:9`
    (collection vars < env vars). Interpolation chokepoints: `RequestEditor.tsx:744/759`
    and `RunnerTab.tsx:96/108`.
  - UI: zustand, custom modals (`.kp-cmdk-overlay`), lucide icons, CodeMirror 6.
- Tropel state: branch `fix/w2-205-name-optional`, concurrent W2 `#203`/`#205`
  work left intentionally uncommitted.
- **Key finding:** the Postman dynamic catalog already exists in Rust —
  `D:\tropel\crates\tropel-variables\src\catalog.rs` (`DynamicCatalog`), with
  fresh-per-occurrence semantics, `:length` caps (`MAX_DYNAMIC_LENGTH`),
  W2 #199 spelling aliases, warn-once for unknowns.
- `@tropel/shims` (already used by KnockPort engine) has **zero** variable
  resolution. `@tropel/runtime-wasm` (`tropel_web.wasm`, 2.5 MB wasip1 + QuickJS)
  exposes only the scenario runner — receives already-resolved variables.

## 2 · First attempt: TypeScript port (later demoted to fallback)

- Wrote `packages/core/src/predefinedVariables.ts` — a 1:1 TS port of the
  catalog (same names, aliases, caps, warn-once), plus `PREDEFINED_VARIABLES`
  metadata table; wired into `resolveVariables` (dynamic pass first), core
  tests (13, all green), URL-bar autocomplete in `RequestEditor.tsx`.
- **User challenged this:** "if tropel already has the catalogue, why reimplement?"

## 3 · Reuse verdict & the web/extension insight

- Verified nothing published from Tropel exposes the catalog to a browser.
- Wrote `D:\knockport\WEB_EXTENSION_RUNTIME_SPLIT.md` — the web app needs only
  `@tropel/shims` (host-JS scripting, already working via `new Function`) + a
  small core tier; `tropel_web.wasm`/QuickJS is extension/M7-only. Also answered
  the relay-execution question: interactive sends stay client-executed
  (relaying the whole pipeline would make us custodians of every secret);
  server-side execution is reserved for the future runner offload feature.
- Concluded: **build the core tier in Tropel** (wasm32-unknown-unknown,
  wasm-bindgen) instead of shipping a TS copy.

## 4 · Tropel changes committed (3 commits, on `fix/w2-205-name-optional`)

| Commit | Content |
|---|---|
| `e308848` `feat(core-wasm): browser core tier exposing the dynamic-variable catalog` | new crate + npm package; catalog hardening (below) |
| `d11ae32` `refactor(core-wasm): serve catalog metadata before init (build-time meta.js)` | metadata extracted from the compiled wasm at build time; sync autocomplete, no import-assertion syntax |
| `8ab9685` `chore(core-wasm): track package.json + align gitignore conventions` | root `*.json` rule had silently excluded the manifest; un-ignored like the shims/exec-wasm packages; `node_modules/` added to the package gitignore |

**Commit `e308848` in detail**
- `crates/tropel-core-wasm/` (new workspace member): thin wasm-bindgen
  adapters over `DynamicCatalog` — `resolve_variables`, `predefined_variables_meta`.
  No catalog duplication; explicit no-workspace-inheritance package fields
  (wasm-pack 0.10's manifest parser rejects them); `wasm-opt = false` in
  wasm-pack metadata (its pinned binaryen predates reference-types).
- `crates/tropel-variables/src/catalog.rs`:
  - `$randomIPV6` handler (8×4 hex groups),
  - `PREDEFINED_VARIABLE_META` static table for editors/CLIs,
  - **portable clock** — `web-time` on `wasm32-non-WASI` (`chrono_now()` /
    `epoch_secs()`); std `SystemTime::now()`/`chrono::Utc::now()` panic there
    and crashed `$timestamp`/`$isoTimestamp` at runtime,
  - **size cuts**: regex narrowed to `default-features = false, features =
    ["std", "unicode-perl"]` (catalog patterns are ASCII-only; the Unicode
    property tables were ~400 KB of dead wasm data — twiggy-measured), chrono
    without serde. Workspace inheritance ignored `default-features = false`
    (root dep has defaults on), so direct version pins were required; native
    consumers checked green after.
- `packages/core-wasm/` (`@tropel/core-wasm`, same layout conventions as
  `packages/runtime-wasm` and `packages/shims`): facade `src/index.js` +
  hand-written `src/index.d.ts` with lazy init + passthrough degradation,
  `smoke.mjs`, `scripts/build.sh` (cargo release-wasm → wasm-bindgen →
  modern binaryen `-Oz` → smoke → 700 KB budget gate), README, LICENSE-APACHE.

**Build pipeline lessons**
- wasm-pack's pinned binaryen can't parse rustc 1.94 output (multi-table);
  pipeline is plain `cargo --profile release-wasm` + the wasm-pack-cached
  `wasm-bindgen.exe` + npm `binaryen` wasm-opt v132 with
  `--enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int
  --enable-reference-types`.
- RNG on `wasm32-unknown-unknown`: `getrandom 0.4` needs an explicit backend
  → `getrandom = { features = ["wasm_js"] }` + `uuid { features = ["js"] }`
  (rand 0.10 no longer re-exports the feature).

**Size result (twiggy-driven):** 1,463 KB → 1,430 KB (release-wasm) →
843 KB (regex narrowing) → **457 KB raw** post bindgen + wasm-opt -Oz →
**144 KB brotli q11** (node-measured; gzip -9 would be 184 KB).

**Verified:** `cargo test -p tropel-variables -p tropel-core-wasm` 46 pass;
native consumers (`tropel-runtime`, `tropel-sandbox`, `tropel-web`,
`tropel-engine`) compile clean; `node smoke.mjs` OK (38 catalog vars).

## 5 · KnockPort changes staged in `packages/core` (uncommitted)

- `packages/core/package.json` — dep `"@tropel/core-wasm": "file:../../../tropel/packages/core-wasm"`; `pnpm install` done (+1 package).
- `packages/core/src/tropel.ts` (new facade):
  - `ensureTropelCore(wasmUrl?)` idempotent init, `isTropelCoreReady()`,
  - `resolvePredefinedVariables()` → **wasm when ready, TS fallback** during
    the pre-init race (both are 1:1 ports of the same catalog),
  - `getPredefinedVariablesMeta()` / `getPredefinedVariableNames()` sync &
    init-free (troper's build-time `meta.js`, TS table as backup),
  - re-export `MAX_DYNAMIC_LENGTH`.
- `packages/core/src/utils.ts` — `resolveVariables` now routes through
  `./tropel.js` (dynamic pass first, plain map second).
- `packages/core/src/index.ts` — exports the facade; `PREDEFINED_VARIABLES`
  explicitly exported to avoid the barrel name collision.
- `packages/ui/src/components/request/RequestEditor.tsx` — autocomplete uses
  `getPredefinedVariableNames()`.
- The TS port (`predefinedVariables.ts` + tests) is **kept as the fallback**;
  not deleted.

## 6 · Decision record: wasm vs TS-only rewrite

Chose wasm: 144 KB brotli lazy-loads after first paint (`API_CLIENT_WEB_PAYLOAD.md §2.1`),
amortizes as auth signing / import parsers join the same tier, and enforces
the one-runtime rule. A 4 KB TS rewrite would only win if variables were the
last such feature — they are the first.

## 7 · Tropel PR #120 — RAISED (https://github.com/transithq/tropel/pull/120)

- Branch `feat/core-wasm` cut clean off `origin/master` (default branch; repo has no
  `main`). Cherry-picked the three working commits (new hashes on the new base):
  `a76aaaa` feat(core-wasm) · `6cd6e1c` refactor: build-time meta.js ·
  `b061e0d` chore: package.json + gitignore conventions.
- Verified on the master base before pushing: 48 rust tests (includes master's merged
  W2 variable tests), `node smoke.mjs` (38 catalog vars), native consumer check.
- PR body carries the full size table, build recipe, and verification notes.
- Local tropel tree restored to `fix/w2-205-name-optional` with concurrent W2 work intact
  (`TROPEL_MASTER_TODO.md` stashed/unstashed around the branch hops).
- **gitignore conventions fixed in the PR** (user asked to align with siblings):
  root `*.json` rule had silently excluded `packages/core-wasm/package.json` →
  un-ignored via `!packages/core-wasm/package.json` (mirrors the shims/exec-wasm
  entries); `packages/core-wasm/.gitignore` gained `node_modules/`; generated `pkg/`
  stays out of git (rebuilt by `scripts/build.sh`, like runtime-wasm's `dist/`+`wasm/`).

## 8 · rustfmt fix + web-time performance inference (follow-up commits/questions)

- User flagged `cargo fmt` failing → applied on the PR branch (`cargo fmt -p
  tropel-variables -p tropel-core-wasm`), verified `--check` = 0 diffs + 48 tests green,
  committed as `878791f style(core-wasm): cargo fmt — variables metadata table + wasm
  adapters` and pushed — PR #120 now has 4 commits.
- User challenged the `catalog.rs` diff ("did you re-add `$randomEmail`?") → audited the
  PR diff against master: **zero handler logic touched/re-added**. All added lines are
  (a) the `PREDEFINED_VARIABLE_META` metadata table (~84 lines, name+description only),
  (b) the genuinely-new `$randomIPV6` handler (4 lines), (c) the portable-clock helpers
  (+18/−5 — the removed lines are only `SystemTime::now()`/`chrono::Utc::now()` call
  sites). `$randomEmail`'s sole diff appearance is a metadata row. Drift guard:
  `tropel-core-wasm`'s `meta_names_all_resolve` test runs every meta name through the
  real catalog.
- **web-time vs native load tests: zero impact, two compile-time gates.**
  1. Dependency gate — `web-time` is under
     `[target.'cfg(all(target_arch = "wasm32", not(target_os = "wasi")))'`.dependencies]`:
     cargo never resolves it for the native load-gen graph.
  2. Code gate — wasm `chrono_now()`/`epoch_secs()` are `#[cfg]`-gated; the native path
     is `std::time::SystemTime::now()` / `chrono::Utc::now()` — byte-for-byte the same
     clock calls as master, just behind an inlined function. `$timestamp` cost inside a
     load run is unchanged.

## 9 · Why a separate `tropel-core-wasm` crate (duplication question, answered)

1. The crate contains **no duplicated logic** — its entire body is two 2-line adapters
   over `DynamicCatalog`; it *depends on* `tropel-variables`, same compiled catalog.
2. `tropel-core` (the name-sibling) is NOT a "core features" crate: it holds only
   engine internals (`config.rs`, `segment.rs` — execution config/stages/thresholds).
3. `tropel-core` cannot compile to wasm: `tropel-http` → `reqwest` → `tokio-net`.
   `tropel-web`'s own Cargo.toml documents this as the "P5b gate".
4. The `#[wasm_bindgen]` boundary must live in *some* crate and can't go in
   `tropel-variables` (crates.io-published, bindgen-free). So core-wasm is the boundary
   crate of this tier, exactly as `tropel-web` is the boundary crate of the wasip1 tier.
5. Alternative considered and rejected: putting the adapters directly in
   `packages/core-wasm` via `wasm-pack` on tropel-variables — would break the publish
   set and lock the npm package to one build profile/ABI.

## 10 · In flight / next moves

1. KnockPort: init wiring — `ensureTropelCore(wasmAssetUrl)` at web boot (lazy,
   non-blocking, per payload doc §2.1) + optional await on send/run paths; the Vite
   `?url` import lives in the UI layer so `packages/core` stays bundler-agnostic.
2. KnockPort A4 verification (core tests, typecheck, `pnpm --filter web build`, manual
   `{{$guid}}` check) + **commit A4** — `feat(core): predefined dynamic $variables via
   tropel core-wasm` — excluding `.gitignore`.
3. Follow/merge Tropel **PR #120** so `@tropel/core-wasm` can move from the `file:` path
   to a published package later.
4. Continue PARITY_TODO Phase 1, one commit each: **A6 secret masking** (editor mask +
   reveal in EnvironmentEditor/CollectionEditor, `serializeVariable` disk/export
   redaction, history entries) → **A5 prompt variables** (detect `$prompt.*` pre-send,
   store-flagged modal, merge answers into `vars` before pre-scripts) → **A3 global
   environment** (lowest-precedence layer in `buildVariableMap`; engine's dead `globals`
   bridge at test-runner.ts:218/235 is the wiring point; Dexie `setDefault` op exists).

## Artifacts

| Path | What |
|---|---|
| `D:\knockport\WEB_EXTENSION_RUNTIME_SPLIT.md` | web vs extension runtime split decision doc |
| `D:\knockport\SESSION_WORK_LOG.md` | this log |
| `D:\tropel\crates\tropel-core-wasm\` | core-tier boundary crate (wasm-bindgen, PR #120) |
| `D:\tropel\packages\core-wasm\` | `@tropel/core-wasm` npm package (PR #120) |
| `D:\knockport\packages\core\src\tropel.ts` | KnockPort facade over core-wasm (staged) |
| `D:\knockport\packages\core\src\predefinedVariables.ts` | TS fallback port (kept, staged) |
| `D:\tropel\crates\tropel-variables\src\catalog.rs` | catalog + metadata + portable clock (PR #120) |
| https://github.com/transithq/tropel/pull/120 | the core-wasm PR |

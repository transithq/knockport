# Tropel — component map, coupling analysis, and the API-client split

**Verified against source.** `transithq/tropel` @ `f136ae48` (master, 2026-08-09), cloned to `/tmp/tropel-src`.
**Size:** 27 workspace crates · 58 206 lines of Rust · 4 971 lines of JS shims.
**Method:** `Cargo.toml` dependency edges extracted per crate, `wc -l` per crate, targeted source reads at every coupling point. Not compiled, not run.

This supersedes the component claims in `TROPEL_ARCHITECTURE.md` §7–§8 and `TROPEL_EXEC_SPLIT.md` §2–§4 — see §6 for what changed and why.

---

## §1 · The 27 crates, by tier

The `Browser?` column answers: does this belong in the API client's WASM bundle?

### T0 — The contract

| Crate | LOC | What it is | Browser? |
|---|--:|---|:--:|
| `tropel-core` | 2 817 | **Leaf — depends on nothing.** `types.rs` (Request/Response/Sample/Auth/Body), `config.rs` (1 010 LOC of engine config), `scenario.rs` (the IR, only 43 LOC), `error.rs`, `clock.rs`, `segment.rs` | ✅ mostly |
| `tropel-ext` | 1 143 | The five extension traits — `InputAdapter`, `Driver`/`DriverInstance`, `DriverHttpClient`, `Protocol`, `Output` — plus `inventory` registry | ✅ traits only |
| `tropel-sdk` | 278 | **Pure re-export shim** over `core` + `ext`. Documented semver policy, feature-gated `unstable-protocol`/`unstable-output`, valid WIT with a parser test | ✅ |

### T1 — Pure semantics (the browser slice)

| Crate | LOC | What it is | Browser? |
|---|--:|---|:--:|
| `tropel-collection` | 1 926 | Postman v2.0/v2.1 JSON → `Scenario`. Folders, events, all body modes, all 8 auth kinds | ✅ |
| `tropel-variables` | 1 413 | `{{var}}` resolution, fixpoint termination, dynamic-variable catalog (`$guid`, `$timestamp`…) | ✅ |
| `tropel-js` | 1 577 | QuickJS host over `rquickjs`. Eval, bytecode cache, interrupt deadline | ✅ ⚠ |
| `tropel-native` | 1 247 | Rust-implemented JS builtins — crypto, hash, encoding, assert, JSON | ✅ |
| `tropel-pm` | 1 729 | `pm.*` state bridge + host functions. Variable scopes, response, assertions, `setNextRequest` | ✅ ⚠ |
| `tropel-es` | 1 032 | ES-module transpiler — strips/rewrites `export` so k6 scripts load | ✅ |
| `js/` shims | 4 971 | chai · lodash · cryptojs · pm-api · k6-shim · exec | ✅ |
| `tropel-http::auth` | *(part of 6 025)* | The nine auth signers. **Pure compute**, published vectors reproduced | ✅ ⚠ |

**≈ 12 700 Rust LOC + 5 000 JS.** That's the API client's core — roughly **22 %** of the tree.

### T2–T6 — Everything that stays native

| Crate | LOC | What it is | Why not browser |
|---|--:|---|---|
| `tropel-http` | 6 025 | `client` (reqwest/rustls/http2) · `dns` · `rps` · `blocking` · `subtimings` · `auth` | Sockets, TLS, connection pools |
| `tropel-engine` | 5 222 | **The god crate — 21 internal deps.** Orchestration, `vu_loop`, `vu_sources` | Depends on everything below |
| `tropel-metrics` | 4 844 | hdrhistogram aggregation, collector, thresholds | Load-shaped, not client-shaped (§3) |
| `tropel-report` | 3 847 | stdout · json · csv · prometheus · statsd · influx · otlp | File and network I/O |
| `tropel-executor` | 3 395 | `VUScheduler` (4 execution modes) + `VURunner` (per-iteration walk) | Threads — **but see §4, `VURunner` is the piece we want** |
| `tropel-wasm` | 3 171 | wasmtime **host** for guest plugins, AOT `.cwasm` cache | wasmtime cannot target wasm32 |
| `tropel-distributed` | 2 309 | Controller + agents, merged metrics | Network topology |
| `tropel-build` | 1 312 | `tropel build --with <crate>` → custom binary | Spawns cargo |

### Inputs and extensions

| Crate | LOC | Deps | Note |
|---|--:|---|---|
| `tropel-input-k6` | 7 231 | sdk + **http, metrics, js, core, native, es** | The k6 driver. **Bypasses the SDK heavily** — 6 direct deps past it |
| `tropel-input-openapi` | 2 199 | sdk only ✅ | |
| `tropel-input-har` | 1 078 | sdk only ✅ | |
| `tropel-input-subprocess` | 588 | sdk only ✅ | |
| `tropel-input-postman` | 170 | sdk + collection | Thin — real work is in `tropel-collection` |
| `tropel-x-grpc` | 821 | sdk only ✅ | |
| `tropel-x-websocket` | 321 | sdk only ✅ | |
| `tropel-x-prometheus` | 180 | sdk + report | Reference `Output` extension |
| `tropel` (CLI) | 40 | core, engine, ext, metrics, x-prometheus | Thin shim |
| `tropel-bench` | 18 | js, native, engine | |

---

## §2 · The real dependency graph

Extracted from `Cargo.toml`, not inferred.

```
                          tropel-core  ◀── leaf, zero internal deps
                               ▲
   ┌────────┬────────┬─────────┼─────────┬──────────┬──────────┐
   │        │        │         │         │          │          │
 ext    variables  metrics  collection  js         es       build
   │                  ▲       ▲          ▲
   │                  │       │          │
  sdk ────────────────┼───────┼──────  native
   ▲                  │       │          ▲
   │                  │       │          │
 adapters             │       │        ┌─┴──────────┐
 extensions           │       │        │  tropel-pm │
                      │       │        └─────┬──────┘
                      │       │              │ ⚠ ONLY for pm.sendRequest
                      │       │              ▼
                      └────── tropel-http ◀──┘   (⚠ dead dep on metrics)
                                  ▲
                                  │
                             tropel-executor  (VUScheduler + VURunner)
                                  ▲
                                  │
                             tropel-engine  ── 21 deps ── the god crate
                                  ▲
                    ┌─────────────┴─────────────┐
                 tropel (CLI)            tropel-distributed
```

### Three couplings that matter, with locations

**① `tropel-pm` → `tropel-http` — and it's one feature.**
`tropel-pm/src/bridge_fns.rs:9` imports `HttpClient`; lines 1100 and 1191 call `execute_blocking`. **That is the entire dependency** — `pm.sendRequest` and nothing else. It drags reqwest, rustls, and http2 into the JS layer, which is the single biggest blocker to a browser build. Severable with a feature flag or a trait.

**② `tropel-http` → `tropel-metrics` is a dead dependency.**
`tropel-http/Cargo.toml:11` declares it. **Zero source references anywhere in the crate.** Deleting the line decouples the I/O layer from the metrics layer for free.

**③ `VURunner` holds a concrete `HttpClient`.**
`tropel-executor/src/runner.rs:12` — `use tropel_http::client::HttpClient`, stored as a struct field. This is the orchestration logic welded to the socket layer, and it's the one real refactor.

**④ Workspace-wide tokio features leak everywhere.**
Root `Cargo.toml` declares `tokio` with `rt-multi-thread`, `net`, `signal`. Every crate that writes `tokio.workspace = true` — including `tropel-js` — inherits all of them, and `net`/`signal` do not exist on `wasm32`. Per-crate feature narrowing is required before anything compiles for the browser.

---

## §3 · Should the API client use the *whole* of Tropel compiled to WASM?

**No.** Three independent reasons, in order of decisiveness:

**1 · Most of it physically cannot compile to `wasm32`.** `tropel-wasm` embeds wasmtime — a WASM *host* cannot itself be a WASM guest. `tropel-http::client` is reqwest over rustls with HTTP/2 and connection pooling; the browser has no sockets. `tropel-executor` and `tropel-distributed` need threads and sockets. `tropel-build` shells out to cargo. `tropel-engine` depends on all four, so it goes too.

**2 · What *could* compile still shouldn't ship.** `tropel-metrics` (4 844 LOC) would probably build, and it is exactly the wrong shape — a load engine aggregates and **discards** (that's how it survives 10k VU); an API client **retains** every byte of one response. Shipping 4.8k LOC of hdrhistogram to render one response is dead weight in a bundle that's already ~2–6 MB from QuickJS.

**3 · The load path isn't in the browser anyway.** Per `API_CLIENT_PLAN.md`, load runs go to transport #2 — the native `tropel agent`. Metrics, thresholds, reporters, and the scheduler run there, on real sockets, with real subtimings. The browser never needs them.

**The answer is the T1 slice: ~12 700 Rust LOC + 5 000 JS, about 22 % of the tree.** Parse, resolve, script, sign, assert. Everything else stays native and is reached over a socket.

---

## §4 · The good news — the seams already exist

Two things I proposed in `TROPEL_EXEC_SPLIT.md` turned out to already be built. The refactor is materially smaller than I described.

### The transport trait exists

`tropel-ext/src/traits.rs:174`:

```rust
pub trait DriverHttpClient: Send + Sync {
    async fn execute(&self, req: &Request) -> Result<Response>;
}
```

The k6 driver path already goes through it (`DriverVuSource.http_client: Arc<dyn DriverHttpClient>`, `vu_sources.rs:64`). The **scenario path does not** — `VURunner` holds a concrete `HttpClient` instead. So step one is not "design a transport abstraction," it's **"make `VURunner` use the abstraction the driver path already uses."**

### The iteration seam exists

`tropel-engine/src/vu_loop.rs:49`:

```rust
pub(crate) trait VuIterationSource: Send {
    async fn run_iteration(&mut self, iteration_index: u64, data_row: …, vu_env: …)
        -> VuIterationOutcome;
}
```

Two implementations — `ScenarioVuSource` (wraps `VURunner`) and `DriverVuSource` (k6). The `VURunner`/`engine` duplication that `TROPEL_CODE_FLOW.md` §4 flagged is **gone**.

### And my state-machine proposal was over-engineered

I argued `tropel-exec` should be a resumable state machine to avoid sync-over-async in the browser. Having read the code: **`VURunner::run_iteration` is already `async fn`, and Rust async works in `wasm32` via `wasm-bindgen-futures`** — a `DriverHttpClient` impl that awaits a JS `Promise` is ordinary code. The main path needs no state machine.

The state machine only buys anything for **`pm.sendRequest`**, which needs a *synchronous* return inside a QuickJS host function. Natively that's `execute_blocking`; in the browser you can't block, so that one call site needs Asyncify, JSPI, or to be unsupported in v1. Scoping it to one function instead of the whole pipeline is a large simplification.

One real wrinkle: `DriverHttpClient: Send + Sync` and `async_trait` boxes futures as `Send`. `JsContext` is `!Sync` (see the comment at `runner.rs:637`). On single-threaded wasm those bounds are pure friction — expect `#[async_trait(?Send)]` behind a `cfg(target_arch = "wasm32")`, or a cfg-gated bound.

---

## §5 · The plan

### Phase A — decouple in place (no new crates, no behaviour change)

| # | Change | Effort |
|---|---|---|
| A1 | Delete the dead `tropel-metrics` dep from `tropel-http/Cargo.toml:11` | minutes |
| A2 | Extract `tropel-http/src/auth.rs` → new `tropel-auth`. Pure compute, tests travel with it | small |
| A3 | Feature-gate `tropel-pm`'s `tropel-http` dep behind `send-request` (default on natively, off for wasm) | small |
| A4 | Replace `VURunner`'s `HttpClient` field with `Arc<dyn DriverHttpClient>` — the driver path's existing pattern | **medium — the real work** |
| A5 | Narrow per-crate tokio features; stop `tropel-js` inheriting `net`/`signal` | small |

After A, `VURunner` no longer references `tropel-http` at all, and the T1 slice has no socket in its tree.

### Phase B — the crate

- **B1** Create `tropel-exec`: move `VURunner` out of `tropel-executor` (which keeps `VUScheduler`). `tropel-exec` depends only on T0 + T1 + `tropel-auth`.
- **B2** Add `tropel-web` — `wasm-bindgen` shim over `tropel-exec`, with a `DriverHttpClient` impl that awaits a host-provided JS `Promise`.
- **B3** CI gate: `cargo check -p tropel-exec --target wasm32-wasip1` must pass, and `cargo tree -p tropel-exec` must not contain `reqwest`, `tokio/net`, or `wasmtime`.

### Phase C — proof and packaging

- **C1** Differential harness: every fixture collection through native-driven and wasm-driven `tropel-exec`, diffing the full outcome. This is what makes the one-engine claim verifiable rather than asserted.
- **C2** `wasm-pack` → `@tropel/exec-wasm` on npm, version-stamped from the same CI job as the binary.
- **C3** `tropel agent` subcommand, so the API client repo carries zero Rust.

### Sequencing against `BACKLOG_V2`

Phase A is orthogonal to everything — take it now. **Phase B must land before BACKLOG_V2 Phase 1** ("the wedge": script composition, variable-engine rewrite, `setNextRequest` semantics), because all of that is `VURunner` code and would otherwise be written twice. `BACKLOG_V2` Phase 0 (units, thresholds, metrics rollup) lives in the metrics/engine layers and is unaffected either way.

## §5b · `tropel-sdk` — the inversion

### A separate repo forces this; it isn't a packaging choice

Today `tropel-sdk` sits at the **top** of the graph, re-exporting downward:

```
tropel-sdk ──re-exports──▶ tropel-ext ──▶ tropel-core
```

Lift that crate into its own repo as-is and it needs `tropel-core` and `tropel-ext` as **cross-repo dependencies** — pointing back into the very repo that is supposed to depend on *it*. Three published crates, a dependency arrow crossing the repo boundary in the wrong direction, and a `[patch]` override needed for every local edit. That is strictly worse than one repo.

So the separate repo is only coherent if the SDK is **self-contained**, which means moving the contract *into* it. The inversion is the prerequisite, and it is the part that actually delivers the modularity.

```
   TARGET — contract at the bottom

     tropel-sdk        leaf · zero internal deps · ~1 700 LOC
         ▲               target-agnostic: no tokio, no reqwest, no fs
         │
         ├── tropel-core      engine config, clock, segment
         ├── tropel-ext       ExtensionRegistry (engine-side resolver)
         ├── tropel-exec      ← the API client's slice depends on it too
         ├── every other crate
         └── third-party extensions
```

This is the `serde` / `http` / `tower` shape: the contract everyone agrees on is a leaf, and the machinery is built on top.

### What moves

| Into `tropel-sdk` | From | LOC |
|---|---|--:|
| `types.rs` — Request, Response, Method, Body, Sample, SampleType, TagMap, AuthConfig, Timings, Cookie, Certificate, ResponseType | `tropel-core` | 906 |
| `scenario.rs` — Scenario, ScenarioInfo, ScenarioItem (**the IR**) | `tropel-core` | 43 |
| `error.rs` — TropelError, Result | `tropel-core` | 50 |
| `parse_duration` | `tropel-core/lib.rs` | ~90 |
| `traits.rs` — InputAdapter, Driver, DriverInstance, DriverHttpClient, VuContext, Protocol, Output | `tropel-ext` | 638 |
| `*Registration` structs + `inventory` re-export | `tropel-ext/registry.rs` | ~100 |
| `wit/adapter.wit` + its parser test | already there | — |

**≈ 1 830 LOC.** Small, stable, and exactly the surface a third party needs.

| Stays behind | Where | Why |
|---|---|---|
| `config.rs` — JobConfig, ExecutionConfig, HttpConfig, TlsConfig, thresholds | `tropel-core` | Engine config. **No adapter author needs any of it** — and today the SDK re-exports eight of these types, each one a semver commitment on 1 010 lines you never meant to promise |
| `clock.rs`, `segment.rs` | `tropel-core` | `Instant`/`SystemTime` and distributed execution segments — engine concerns, and the `std::time` dependency is exactly what must not be in a wasm-targeting leaf |
| `ExtensionRegistry` (`registry.rs`, 495 LOC) | `tropel-ext` | The engine's *resolver*. An extension **registers**; only the engine **resolves**. Drop it from the SDK's public surface |

`tropel-ext` shrinks from 1 143 LOC to the registry alone.

### Feature-gate `inventory`

The API client's `tropel-exec` will depend on `tropel-sdk` for the types, but a browser build does no plugin discovery:

```toml
[features]
default   = ["registration"]     # inventory + *Registration — extension authors
registration = ["dep:inventory"]
```

`tropel-exec` takes `default-features = false` and gets pure types. **Verify `inventory` on `wasm32` before relying on it either way** — it depends on life-before-main / custom link sections, and support has historically varied by target.

### Naming

Once inverted, the leaf is called `tropel-sdk` and `tropel-core` is not the core. Mildly odd. **Keep the names anyway** — `tropel-sdk` is already the published identity with a written semver policy, "SDK" correctly signals *this is what you depend on*, and renaming `tropel-core` touches all 27 crates for zero functional gain. Note the oddity in the docs; don't pay to fix it.

### Recommendation on the repo split: do it, but not first

**Invert now, in the monorepo. Publish immediately. Split the repo later.**

The separate repo buys less than it looks like:

- **It does nothing for extension authors.** They run `cargo add tropel-sdk` — crates.io is the interface, not GitHub. Nobody clones an SDK repo to use it.
- **It taxes every contract change.** Add a field to `Response`, add a `Driver` method: PR in the SDK repo → release → version bump in the tropel repo → second PR. One commit becomes two PRs and a release. `TROPEL_CODE_FLOW.md` went six weeks stale in this codebase; the churn is real.
- **The contract isn't stable yet.** `BACKLOG_V2` Phase 0 is *the units problem* — it changes `Sample` semantics. Phase 1 reshapes scenario/script semantics. Phase 3 adds `Response` members and `Params` fields. Splitting a contract that's about to move three times means three cross-repo release cycles.

What you actually want from "completely modular" — a self-contained contract, no reaching into internals, one crate to publish, a clean dependency direction — is delivered **entirely by the inversion**. The repo boundary adds enforcement, and you can get that in-repo today with CI:

```
cargo tree -p tropel-sdk        # must show zero tropel-* dependencies
cargo check -p tropel-sdk --target wasm32-unknown-unknown
cargo package -p tropel-sdk && build a sample extension against it, outside the workspace
```

That third one is the real proof of "no full checkout required" — and it's the same test you'd run after a repo split anyway.

Then split with `git subtree split -P crates/tropel-sdk` once the contract stops moving — after the Phase 0–2 release gate. History is preserved and the split becomes a non-event, because the crate is already a leaf by then.

### Order of work

1. Move the seven items above into `tropel-sdk`; make it a leaf.
2. Point `tropel-core` / `tropel-ext` / everything else at it.
3. Trim the eight `config.rs` re-exports out of the public surface.
4. Feature-gate `inventory`.
5. Close the `tropel-input-k6` bypass — six deps past the SDK. It's the most demanding in-tree consumer, so whatever it reaches around for is precisely what the SDK is missing.
6. Add the three CI gates.
7. Publish `tropel-sdk` 0.1.0 — **one crate, no path-dep problem.**
8. Split the repo when the contract is stable.

---

## §6 · Corrections to the earlier documents

Read these before trusting the older files.

| Claim | Source | Reality at `f136ae48` |
|---|---|---|
| `VURunner` is dead code, never constructed | `CODE_FLOW` §4 | **Live.** Built at `vu_loop.rs:568`, driven via `ScenarioVuSource` |
| `engine` and `VURunner` duplicate `run_iteration` | `CODE_FLOW` §4, `EXEC_SPLIT` §4 | **Resolved.** One `VuIterationSource` trait, two impls |
| `tropel-js` is a stub; no JavaScript executes | `CODE_FLOW` §4 | **Stale.** QuickJS is live with bytecode caching and interrupt deadlines |
| Nothing depends on `tropel-sdk` | `ARCH_REVIEW` 🟡 | **Fixed.** har/openapi/subprocess/postman and all three extensions use it. Only k6 bypasses |
| The WIT is broken and won't resolve | `ARCH_REVIEW` 🟡 | **Fixed.** `wit/adapter.wit` resolves, with a `wit-parser` regression test naming the old failure |
| `tropel-exec` should be a resumable state machine | `EXEC_SPLIT` §3 | **Over-engineered.** Rust async works in wasm32; only `pm.sendRequest` needs special handling |
| A transport abstraction needs designing | `EXEC_SPLIT` §3–4 | **Already exists** — `DriverHttpClient`, `tropel-ext/traits.rs:174`. `VURunner` just doesn't use it |
| `tropel-metrics` belongs in the browser slice | `ARCHITECTURE` §8 (first draft) | Corrected in that file already — native only |

The pattern: the review documents are **snapshots**, and this tree moves fast. `CODE_FLOW` (Jul 29) is ~6 weeks of work behind. Date-stamp claims and re-verify before acting on any of them.

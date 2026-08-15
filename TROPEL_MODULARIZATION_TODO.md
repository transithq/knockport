# Tropel modularization — execution checklist

**Goal:** invert `tropel-sdk` into a self-contained leaf, publish it, and carve out the browser-safe slice the API client consumes.
**Baseline:** `transithq/tropel` @ `f136ae48` (2026-08-09) · 27 crates · 58 206 Rust LOC.
**Background:** `TROPEL_COMPONENT_MAP.md` (crate map + coupling analysis) · `TROPEL_EXEC_SPLIT.md` (distribution) · `API_CLIENT_PLAN.md` (product).

Self-contained — every command needed is in this file.

> ### ⚠ How Tropel consumes `tropel-sdk` — the lifecycle
>
> **The principle is permanent: never gate your own development on a publish cycle.** The mechanism that expresses it changes as the repo layout changes.
>
> | Stage | Declaration | Why |
> |---|---|---|
> | **Now** — SDK in the monorepo | `{ path = "crates/tropel-sdk", version = "0.1.0" }` | Cargo uses the **path** locally and writes the **version** into published metadata. Both true at once — how tokio and serde do it. A contract change is one commit |
> | **After P7** — SDK in its own repo, pre-1.0 | `{ git = "https://github.com/transithq/tropel-sdk", tag = "v0.2.0" }` | Still no publish cycle to iterate. **Legal precisely because every Tropel crate is `publish = false`** (P0) — cargo only forbids git deps in crates you actually publish |
> | **Post-1.0** — contract stable | `tropel-sdk = "1.x"` — optional | Once it changes twice a year instead of twice a week, the publish cost vanishes and the registry dep is simpler. Switch if you want to; nothing forces it |
>
> **Why not a registry dep before then:** every contract change would require publishing to crates.io *before* Tropel could use it, and crates.io releases are permanent (yank-only, never deleted). You'd burn a version per iteration on a contract `BACKLOG_V2` is about to break three times.
>
> **The one thing that forces a registry dep:** publishing a *second* Tropel crate that depends on the SDK — e.g. `tropel-exec`, if a Rust consumer ever appears. A published crate cannot have git or path-only dependencies. Per `TROPEL_EXEC_SPLIT.md` §5 the API client consumes npm + a process boundary, so this isn't on the path today.
>
> **You don't lose dogfooding by avoiding the registry dep.** The thing a registry dep would catch — a broken `.crate` package, missing files, feature-flag mistakes — is exactly what **P2 Gate 3** already tests, by building a real sample extension against the `cargo package`d artifact outside the workspace. That gate is the dogfooding mechanism; the dependency style is not.

---

## 0 · Machine setup — run once

```bash
# ── toolchain ──────────────────────────────────────────────────────
rustup update stable
rustup target add wasm32-unknown-unknown wasm32-wasip1

# ── tools used below ───────────────────────────────────────────────
cargo install wasm-pack            # P5  wasm build
cargo install twiggy               # P5  wasm size audit
cargo install cargo-semver-checks  # P2  API-break detection
brew install binaryen              # P5  provides wasm-opt
brew install git-filter-repo       # P7  history-preserving repo split
brew install jq                    # optional, used by a couple of gates

# ── repo ───────────────────────────────────────────────────────────
git clone https://github.com/transithq/tropel
cd tropel
cargo build --workspace            # baseline: does it build before you start
```

---

## Status — 2026-08-09

| Phase | State |
|---|---|
| **P0** Manifest hygiene | ✅ **DONE** |
| **P1** SDK inversion | ✅ **DONE** |
| **P7** SDK repo split | ✅ **DONE** — SDK now lives in its own repo |
| P2 CI gates · P3 publish SDK | ⬜ unconfirmed — verify with the blocks in those sections |
| **P3c** publish the 6 runtime crates | ⬜ open — **the master shipping list lives here** |
| P3b polyglot · P4 decouple · P4b sandbox · P4c native adapter · P5 runtime/scheduler · P6 packaging | ⬜ open |

**Items below are kept, not deleted** — completed ones are marked so the reasoning stays readable.

### Execution order

**P1b → P3c** *(names only)* **→ P4a → P5a → P4b → P4d → P2 → P3 → P5b → P3c → P6 → P4c → P3b**

Critical path: **P5a → P4b → P4d**. Done: P0, P1, P7.

---

## P1b · Post-split fixup — do first

> ### ⚠ The SDK split changes the dependency declaration
> Now that the SDK is in its own repo, the path dependency no longer resolves. Per the lifecycle table at the top:
> ```toml
> # root Cargo.toml → [workspace.dependencies]
> tropel-sdk = { git = "https://github.com/transithq/tropel-sdk", tag = "v0.1.0" }
> ```
> - [ ] Swap `path` → `git` in the Tropel workspace
> - [ ] Tag the SDK repo so the dependency is pinned, not floating on a branch
> - [ ] Confirm `cargo build --workspace` still passes in Tropel
>
> Legal because every Tropel crate is `publish = false`. Cargo only rejects git deps in crates you actually publish.

---

## P0 · Manifest hygiene ✅ DONE

> **Lighter than it first appears.** After P1, `tropel-sdk` is a **leaf with zero internal dependencies** — so publishing it does *not* require publishing `tropel-core` or `tropel-ext`, and their manifests never need `description`. If you already added those, harmless, just unnecessary.

- [ ] **Fix the stale repository URL** — root `Cargo.toml:36` still points at the old owner. It renders on the crates.io page.
      ```toml
      # root Cargo.toml → [workspace.package]
      repository = "https://github.com/transithq/tropel"
      ```

- [ ] **Mark internal crates unpublishable** so a stray `cargo publish --workspace` can't leak them:
      ```bash
      cd crates
      for c in tropel tropel-core tropel-ext tropel-es tropel-engine tropel-executor \
               tropel-http tropel-metrics tropel-report tropel-collection tropel-variables \
               tropel-js tropel-pm tropel-native tropel-wasm tropel-build \
               tropel-distributed tropel-bench \
               inputs/* extensions/*; do
        grep -q '^publish' "$c/Cargo.toml" || \
          sed -i '' '/^version = /a\
publish = false
' "$c/Cargo.toml"
      done
      cd ..
      git diff --stat
      ```

- [ ] **Add `version` alongside `path`** for internal workspace deps — root `Cargo.toml:180,190,191` are path-only today. Not strictly required once the SDK is a leaf, but it costs nothing and unblocks publishing anything else later.
      ```toml
      tropel-core = { path = "crates/tropel-core", version = "0.1.0" }
      tropel-ext  = { path = "crates/tropel-ext",  version = "0.1.0" }
      tropel-sdk  = { path = "crates/tropel-sdk",  version = "0.1.0" }
      ```

- [ ] **Reserve the crates.io names.** All five were available as of 2026-08-09. A public repo with this much visible design gets squatted.
      ```bash
      # check current availability
      for n in tropel tropel-core tropel-ext tropel-sdk tropel-exec; do
        printf "%-14s " "$n"
        curl -s "https://crates.io/api/v1/crates/$n" | grep -q '"errors"' \
          && echo AVAILABLE || echo TAKEN
      done

      # reserve: token from https://crates.io/settings/tokens
      cargo login
      ```
      Reserving requires publishing a stub. `tropel-sdk` gets a real 0.1.0 in P3; for the others, publish a `0.0.0` placeholder lib only if you want to hold the name.

- [ ] **Verify the manifest is publishable**
      ```bash
      cargo publish -p tropel-sdk --dry-run --allow-dirty
      ```

---

## P1 · The inversion — make `tropel-sdk` a leaf ✅ DONE

**Gate:** `cargo tree -p tropel-sdk` shows zero `tropel-*` dependencies.

> Retained for reference. Worth re-running the gate in the new SDK repo:
> ```bash
> cargo tree -p tropel-sdk --edges normal --prefix none | tail -n +2 | grep '^tropel-' \
>   && echo "FAIL: not a leaf" || echo "PASS"
> ```

### Rule: pure moves, separate commits

Git does not record renames — it infers them by content similarity at read time. A move bundled with import fixes may not register as a rename, which breaks `--follow` **and makes the P7 history extraction much harder to verify.**

> **Move in one commit. Fix imports in the next.** No exceptions.

### Step 1 — pre-split the two partial extractions

`parse_duration` lives inside `tropel-core/src/lib.rs`, and the `*Registration` structs live inside `tropel-ext/src/registry.rs`. Neither can be `git mv`'d out of a shared file — so split them into their own files **first**, as no-behaviour-change commits. This is what makes their history survivable in P7.

- [ ] Move `parse_duration` (+ its tests) from `crates/tropel-core/src/lib.rs` into a new `crates/tropel-core/src/duration.rs`; add `pub mod duration; pub use duration::*;`
      ```bash
      cargo test -p tropel-core
      git add crates/tropel-core/src/
      git commit -m "refactor(core): split parse_duration into duration.rs (no behaviour change)"
      ```

- [ ] Move `InputAdapterRegistration`, `DriverRegistration`, `ProtocolRegistration`, `OutputRegistration` from `crates/tropel-ext/src/registry.rs` into a new `crates/tropel-ext/src/registration.rs`, leaving `ExtensionRegistry` behind
      ```bash
      cargo test -p tropel-ext
      git add crates/tropel-ext/src/
      git commit -m "refactor(ext): split registration structs out of registry.rs (no behaviour change)"
      ```

### Step 2 — the pure move

- [ ] ```bash
      git mv crates/tropel-core/src/types.rs        crates/tropel-sdk/src/types.rs
      git mv crates/tropel-core/src/scenario.rs     crates/tropel-sdk/src/scenario.rs
      git mv crates/tropel-core/src/error.rs        crates/tropel-sdk/src/error.rs
      git mv crates/tropel-core/src/duration.rs     crates/tropel-sdk/src/duration.rs
      git mv crates/tropel-ext/src/traits.rs        crates/tropel-sdk/src/traits.rs
      git mv crates/tropel-ext/src/registration.rs  crates/tropel-sdk/src/registration.rs

      git commit -m "refactor(sdk): move contract types and traits into tropel-sdk (pure move, no edits)"
      ```

      **Confirm git saw them as renames — this is what P7 depends on:**
      ```bash
      git show --stat -M --summary HEAD | grep -E "rename|=>"
      ```
      Six rename lines. If any file shows as delete+add instead, the commit wasn't pure — redo it.

### Step 3 — stays behind (verify, don't move)

- [ ] `crates/tropel-core/src/config.rs` (1 010 LOC) — JobConfig, ExecutionConfig, HttpConfig, TlsConfig, thresholds. **No adapter author needs any of it**
- [ ] `crates/tropel-core/src/clock.rs`, `segment.rs` — the `std::time` dependency is exactly what must not be in a wasm-targeting leaf
- [ ] `crates/tropel-ext/src/registry.rs` — `ExtensionRegistry` is the engine's *resolver*. An extension **registers**; only the engine **resolves**

### Step 4 — rewire

- [ ] Reverse the direction: `tropel-core` and `tropel-ext` now depend on `tropel-sdk`
- [ ] Update imports across the other 24 crates
- [ ] **Trim the public surface** — `crates/tropel-sdk/src/lib.rs` currently re-exports eight `config.rs` types (`ExecutionConfig`, `HttpConfig`, `OutputConfig`, `ScenarioConfig`, `Stage`, `ThinkTimeConfig`, `ThresholdConfig`, `TlsConfig`). Drop all eight — each published one is a permanent semver commitment on engine config
- [ ] Drop `ExtensionRegistry` from the SDK's re-exports
- [ ] **Feature-gate `inventory`:**
      ```toml
      # crates/tropel-sdk/Cargo.toml
      [features]
      default      = ["registration"]
      registration = ["dep:inventory"]

      [dependencies]
      inventory = { workspace = true, optional = true }
      ```
- [ ] **Close the `tropel-input-k6` bypass** — it takes six deps past the SDK (`http`, `metrics`, `js`, `core`, `native`, `es`). The most demanding in-tree consumer, so what it reaches around for is precisely what the SDK is missing.
      ```bash
      cargo tree -p tropel-input-k6 --edges normal --prefix none | tail -n +2 | grep '^tropel-'
      ```

- [ ] ```bash
      cargo build --workspace && cargo test --workspace
      git commit -am "refactor: point workspace at tropel-sdk; trim SDK surface"
      ```

**Naming:** afterwards the leaf is `tropel-sdk` and `tropel-core` is not the core. Keep both names — `tropel-sdk` is the published identity with a written semver policy, and renaming `tropel-core` touches all 27 crates for zero functional gain.

---

## P2 · CI gates — the enforcement that replaces a repo boundary

Drop this in as `scripts/sdk-gates.sh` and call it from CI:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "── Gate 1: tropel-sdk must be a leaf ──"
if cargo tree -p tropel-sdk --edges normal --prefix none | tail -n +2 | grep -q '^tropel-'; then
  echo "FAIL: tropel-sdk has internal dependencies:"
  cargo tree -p tropel-sdk --edges normal --prefix none | tail -n +2 | grep '^tropel-'
  exit 1
fi
echo "PASS"

echo "── Gate 2: tropel-sdk is target-agnostic ──"
cargo check -p tropel-sdk --target wasm32-unknown-unknown --no-default-features
cargo check -p tropel-sdk --target wasm32-unknown-unknown          # incl. inventory
echo "PASS"

echo "── Gate 3: builds from outside the workspace ──"
cargo package -p tropel-sdk --allow-dirty
VER=$(grep -m1 '^version' crates/tropel-sdk/Cargo.toml | cut -d'"' -f2)
WORK=$(mktemp -d)
tar xzf "target/package/tropel-sdk-${VER}.crate" -C "$WORK"

mkdir -p "$WORK/sample-ext/src"
cat > "$WORK/sample-ext/Cargo.toml" <<EOF
[workspace]
[package]
name = "sample-ext"
version = "0.0.0"
edition = "2021"

[dependencies]
tropel-sdk = { path = "../tropel-sdk-${VER}" }
EOF

cat > "$WORK/sample-ext/src/lib.rs" <<'EOF'
use tropel_sdk::{
    InputAdapter, InputAdapterRegistration, Scenario, ScenarioInfo, TropelError, inventory,
};

pub struct SampleAdapter;

impl InputAdapter for SampleAdapter {
    fn id(&self) -> &str { "sample" }
    fn detect(&self, bytes: &[u8]) -> bool { bytes.starts_with(b"SAMPLE\n") }
    fn parse(&self, _bytes: &[u8]) -> Result<Scenario, TropelError> {
        Ok(Scenario {
            info: ScenarioInfo { name: "sample".into(), description: None, schema: None },
            items: vec![],
            variables: Default::default(),
            auth: None,
        })
    }
}

inventory::submit!(InputAdapterRegistration::new("sample", || Box::new(SampleAdapter)));
EOF

cargo build --manifest-path "$WORK/sample-ext/Cargo.toml"
echo "PASS — SDK is usable with no Tropel checkout"
rm -rf "$WORK"
```

- [ ] Wire it into CI:
      ```yaml
      # .github/workflows/ci.yml
      sdk-gates:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: dtolnay/rust-toolchain@stable
            with: { targets: wasm32-unknown-unknown }
          - run: bash scripts/sdk-gates.sh
      ```

- [ ] Add API-break detection once 0.1.0 is out:
      ```bash
      cargo semver-checks check-release -p tropel-sdk
      ```

---

## P3 · Publish

```bash
cargo login                                   # https://crates.io/settings/tokens
cargo publish -p tropel-sdk --dry-run
cargo publish -p tropel-sdk

# verify docs.rs picked it up (a few minutes later)
open https://docs.rs/tropel-sdk
```

- [ ] Write `crates/tropel-sdk/README.md` — the quick-start already exists in the `lib.rs` doc comment; lift it out
      ```toml
      # crates/tropel-sdk/Cargo.toml
      readme = "README.md"
      ```
- [ ] Keep Tropel on `{ path, version }` — see the box at the top

> **Timing:** `BACKLOG_V2` Phase 0 changes `Sample` semantics (the units problem), Phase 1 reshapes scenario/script semantics, Phase 3 adds `Response` members. Each is a breaking change → 0.2.0, 0.3.0, 0.4.0. Pre-1.0 semver is designed for exactly this, so publishing now is legitimate — just don't advertise it as stable. If you'd rather not churn early adopters, publish `0.0.1` to hold the name and cut the real `0.1.0` after Phase 1.

---

## P3b · Polyglot extensions — one WIT, not N SDKs

**You do not publish an SDK per language.** One interface definition plus the ecosystem's binding generators covers all of them. That is the entire reason the Component Model exists.

### What's actually true today

`tropel-wasm` runs guests over a **raw C ABI** — the guest exports `id`/`detect`/`parse` plus `malloc`/`free` and communicates through linear memory with hand-rolled pointer/length marshalling. The SDK's own doc comment says so: *"WASM plugins currently use the C ABI in `tropel-wasm`."*

So "any language" today means **any language that compiles to `wasm32` and can export C-ABI functions**:

| Practical | Not practical without an embedded interpreter |
|---|---|
| Rust · C/C++ · Zig · TinyGo · AssemblyScript · Swift | Python (Pyodide) · Ruby · JavaScript (Javy) · C# — multi-MB guests, very different embedding |

And every one of those authors hand-writes the marshalling. That's error-prone — *the host* got `free`'s signature wrong (`wasm/driver.rs:174`, `TypedFunc<i32,i32>` vs C's `(i32) -> ()`); guests will do worse.

### The path that removes the problem

```
        ONE FILE                    COMMUNITY TOOLS              ZERO WORK FOR YOU
   ┌──────────────────┐
   │  wit/adapter.wit │──┬── wit-bindgen (Rust)      ──▶  Rust extension
   └──────────────────┘  ├── wit-bindgen c           ──▶  C / C++ / Zig
                         ├── wit-bindgen-go / TinyGo ──▶  Go
                         ├── componentize-py         ──▶  Python
                         ├── jco                     ──▶  JS / TS
                         └── componentize-dotnet     ──▶  C#
```

You publish **the `.wit`**. Authors run their language's generator against it. There is no `@tropel/sdk` on npm, no Go module, no PyPI package to maintain — and no N-way version skew when the contract changes.

### You already scoped the WIT correctly

`crates/tropel-sdk/wit/adapter.wit` defines world `tropel-adapter-world` exporting `tropel-adapter` with exactly `id` / `detect` / `parse` — i.e. **`InputAdapter`, the declarative tier**. That is the right tier for components, and deliberately so:

- **Declarative (`InputAdapter`)** — parse runs **once**, before the test. Canonical-ABI marshalling cost is irrelevant. ✅ components
- **Imperative (`Driver`)** — runs **per iteration**, on the hot path. Keep it on the C ABI or native static linking. ❌ components, for now

That split is already the position in `TROPEL_CHALLENGES.md`: *"push every possible format into the declarative lane."* The WIT covering only the adapter is correct, not an omission.

### `tropel-sdk` is not made redundant

It remains the **Rust** story, and Rust is the only language that needs a real crate:

- **Tier 1 — native, statically linked** via `tropel build --with`. No wasm involved at all. Rust-only by construction, needs the crate.
- **Tier 2 — wasm guest.** A Rust author can use `tropel-sdk` + C ABI *or* `wit-bindgen`, whichever they prefer.

### To do

- [ ] **Move `wit/` to the repo root** when the SDK splits (P7). Burying the polyglot contract inside a Rust crate is the wrong shape — a Go author should be able to fetch one file without touching cargo
      ```bash
      git mv crates/tropel-sdk/wit .          # update the wit-parser test's path
      ```
- [ ] **Confirm `wit/` ships in the published crate** so Rust users get it too
      ```bash
      cargo package -p tropel-sdk --allow-dirty --list | grep wit/
      ```
- [ ] **Document the polyglot path** in the SDK README — one `wit-bindgen` example, one non-Rust example
- [ ] **Do not build the component host yet.** `tropel-wasm` still has the `.cwasm` cache-authentication RCE (`BACKLOG_V2` §1, Phase 2 release gate), no epoch interruption, and `total_core_instances` left at wasmtime's default. **Fixing an exploitable host outranks widening the language surface** — and there are no third-party extension authors yet to widen it for

### If per-language packages are ever wanted

Generate them from the WIT in CI; never hand-maintain them. And only once real demand exists — a published `.wit` plus a README covers every language today at zero ongoing cost.

---

## P3c · Publishing `tropel-runtime` — the six-crate set

> **The Cargo rule that drives all of this:** a published crate's dependencies must themselves be published. Cargo does not bundle or vendor — every dep resolves from crates.io, transitively. So `cargo add tropel-runtime` requires *everything it reaches* to be on the registry. "Reachable via `tropel-sandbox`" isn't a thing: `tropel-sandbox` doesn't contain `tropel-js`, it depends on it.
>
> This is the same rule that forced the P1 inversion. `tropel-sdk` could be made a leaf; `tropel-runtime` cannot — it genuinely needs a JS engine and a variable resolver.

### The set — 6 new crates

| Crate | Publish? | Why |
|---|:--:|---|
| `tropel-sdk` | ✅ done | the extension contract |
| `tropel-runtime` | **yes** | the product |
| `tropel-sandbox` | **yes** | runtime needs it |
| `tropel-js` | **yes** | sandbox needs it |
| `tropel-native` | **yes** | sandbox needs it |
| `tropel-variables` | **yes** | runtime resolves `{{vars}}` |
| `tropel-auth` | **yes** | runtime signs requests |
| `tropel-collection` | **no** | **dead dependency — see below** |
| `tropel-core` | **no** | droppable with a 5-item cleanup — see below |
| everything else | **no** | `publish = false` |

### Removal 1 — `tropel-collection` is a dead dependency

- [ ] **Delete it from `tropel-executor/Cargo.toml`.** Declared, but **zero source references** anywhere in the crate — same class as the `tropel-http` → `tropel-metrics` dead dep in P4.
      ```bash
      grep -rn "tropel_collection" crates/tropel-executor/ || echo "confirmed dead — safe to remove"
      ```
      Architecturally correct too: the runtime consumes a `Scenario`; it does not parse Postman JSON. Parsing is an input-adapter concern, so `tropel-collection` stays private.

### Removal 2 — `tropel-core`, five items away from droppable

After P1 moved types/scenario/error into the SDK, this is **everything** the runtime tree still takes from `tropel-core`:

| Crate | Remaining usage |
|---|---|
| `runner.rs` | `config::{ExpectedStatus, HttpConfig, status_is_expected}` |
| `tropel-pm` | `clock::monotonic_wall_now` |
| `tropel-js` | `clock::monotonic_now_nanos` |
| `tropel-variables`, `tropel-collection`, `tropel-native` | **nothing** |

- [ ] Move `ExpectedStatus` + `status_is_expected` into `tropel-runtime` — they're runtime semantics, not engine config
- [ ] Decide where `HttpConfig` lives (SDK, or a runtime-local subset)
- [ ] **Inject the clock rather than reading it.** `Instant::now()` panics on `wasm32-unknown-unknown`, so this is required for the browser build regardless — and it makes the P6 differential harness deterministic
- [ ] Verify: `cargo tree -p tropel-runtime | grep tropel-core` returns nothing

### Mark the five internals

Five of the six are implementation detail. You cannot stop someone depending on `tropel-js` directly, but you can signal it — the `futures-core` / `tokio-macros` / `serde_derive` convention:

- [ ] ```toml
      description = "Internal to tropel-runtime. No stability guarantee — depend on tropel-runtime instead."
      ```
- [ ] Add a matching `#![doc = "..."]` banner at the top of each `lib.rs`

### Timing and automation

`BACKLOG_V2` Phase 1 rewrites the variable engine, script composition, and `setNextRequest` — all inside `tropel-runtime`/`tropel-sandbox`. Publishing now means 0.2 → 0.3 → 0.4 in quick succession **across six crates each time**, with no third-party consumers yet.

- [ ] **Reserve the six names now** with `0.0.0` placeholders — cheap, and squattable on a public repo
- [ ] Offer a **git dep** to any early adopter meanwhile — works today, costs nothing
- [ ] **Publish for real after the Phase 0–2 release gate**
- [ ] **Automate ordered multi-crate publishing** — `cargo-release` or `cargo-workspaces`. Six publishes in dependency order, by hand, every release will not survive contact with reality
      ```bash
      cargo install cargo-release
      cargo release --workspace --execute
      ```

### Master list — everything that ships, and where

| Artifact | Channel |
|---|---|
| `tropel-sdk` + the 6 runtime crates | **crates.io** |
| `@tropel/runtime-wasm` — compiled wasm + TS bindings | **npm** |
| `@tropel/shims` — the `js/` bundle | **npm** |
| `tropel` binary, incl. `tropel agent` | **GitHub Releases** |

**Repos: two, and no more.** `transithq/tropel` (the monorepo) and `transithq/tropel-sdk` (already split, because the inversion made it a leaf). Nothing else gets its own repo — `tropel-runtime` and `tropel-sandbox` are middle nodes, and **repos extract cleanly at leaves only**. Publishing to crates.io is what removes the need for a checkout; a repo split does nothing for consumers.

The one future candidate is `js/` — 4 971 lines of pure JavaScript depending only on an 81-function `__tropel_*` host ABI, so it *is* a leaf. Ship it as `@tropel/shims` from the monorepo first; split the repo only if outside contribution actually materialises.

---

## P4a · Free wins — dead deps + `tropel-auth`

*Independent of everything. Minutes each, zero risk.*

- [ ] **Delete dead dep 1.** `crates/tropel-http/Cargo.toml:11` declares `tropel-metrics` with **zero source references**.
      ```bash
      grep -rn "tropel_metrics" crates/tropel-http/src/ || echo "confirmed dead — safe to remove"
      sed -i '' '/tropel-metrics.workspace/d' crates/tropel-http/Cargo.toml
      cargo build -p tropel-http
      ```

- [ ] **Delete dead dep 2.** `tropel-executor` declares `tropel-collection`, also with zero references. Removing it is architecturally right — the runtime consumes a `Scenario`, it does not parse Postman JSON.
      ```bash
      grep -rn "tropel_collection" crates/tropel-executor/ || echo "confirmed dead — safe to remove"
      ```

- [ ] **Extract `tropel-auth`** from `crates/tropel-http/src/auth.rs` — pure compute, vectors already reproduced.
      ```bash
      cargo new --lib crates/tropel-auth
      git mv crates/tropel-http/src/auth.rs crates/tropel-auth/src/lib.rs
      git commit -m "refactor(auth): extract signers from tropel-http (pure move)"
      # then: add to workspace members, fix imports, move tests
      ```

- [ ] **CI path filters** — do this here; it speeds up every PR that follows
      ```yaml
      # .github/workflows/ci.yml  (currently has none — every PR runs the full workspace)
      on:
        pull_request:
          paths: ['crates/**', 'js/**', 'Cargo.toml']
      ```

---

## P4d · Decoupling — after the P5a/P4b renames

*Do these inside the new crate structure, not before it.*

- [ ] **Feature-gate `pm.sendRequest`.** `crates/tropel-pm/src/bridge_fns.rs:9,1100,1191` is the *entire* `tropel-pm → tropel-http` dependency.
      ```toml
      # crates/tropel-pm/Cargo.toml
      [features]
      default      = ["send-request"]
      send-request = ["dep:tropel-http"]

      [dependencies]
      tropel-http = { workspace = true, optional = true }
      ```
      ```bash
      cargo check -p tropel-pm --no-default-features
      ```

- [ ] **Narrow tokio features per crate.** The root workspace declares `net` + `signal` + `rt-multi-thread`; `tropel-js` inherits all of them via `tokio.workspace = true`, and `net`/`signal` don't exist on wasm32.
      ```toml
      # crates/tropel-js/Cargo.toml — replace tokio.workspace = true
      tokio = { version = "1.53.1", default-features = false, features = ["sync", "macros", "time"] }
      ```

- [ ] **Replace `VURunner`'s concrete `HttpClient`** with `Arc<dyn DriverHttpClient>` — `crates/tropel-executor/src/runner.rs:12`. The trait already exists at `crates/tropel-ext/src/traits.rs:174`, and the k6 path already uses it (`vu_sources.rs:64`); the scenario path just doesn't. ***(the real work)***

**Gate:**
```bash
grep -n "tropel_http" crates/tropel-executor/src/runner.rs \
  && echo "FAIL: VURunner still references tropel-http" \
  || echo "PASS"
```

---

## P4b · Binding-agnostic scripting — `tropel-pm` → `tropel-sandbox`

### The name

**`tropel-sandbox`**, for the same reason `tropel-runtime` earned its name: `postman-sandbox` is the exact analogue (6.7.3, already in your parity doc), and the pair relationship is identical — `postman-runtime` drives `postman-sandbox`.

```
tropel-runtime   ←  postman-runtime     walks the scenario
tropel-sandbox   ←  postman-sandbox     script state + API bindings
tropel-js        ←  uvm / vm            QuickJS host
```

Anyone who knows the Postman stack reads that immediately. `tropel-script-state` names only half of it.

### One crate, feature-gated modules — not a crate or repo per binding

**No separate repo.** It fails the test the SDK passed: *strangers must consume it directly*. Nobody does — Tropel's runtime uses it, and the API client reaches Tropel via npm + a process boundary, never linking a Rust crate. There is no cross-repo consumer, and it changes constantly (`BACKLOG_V2` Phase 1 rewrites variable scoping).

**And don't split state from bindings into separate crates.** Bindings need deep access to state, so a crate boundary forces a wide public API — exactly what you're trying to avoid. One crate, modules, feature flags:

```toml
# crates/tropel-sandbox/Cargo.toml
[features]
default        = ["binding-native", "binding-pm"]
binding-native = []      # the canonical API
binding-pm     = []      # Postman compat
binding-bru    = []      # Bruno compat
```

Real modularity — the wasm build drops bindings it doesn't ship, which is genuine bundle savings — while `pub(crate)` keeps internals tight.

### The canonical binding's name — DECIDED: `trp.*`

**The binding belongs to the layer that implements it.** `pm.*` is Postman's because postman-sandbox implements it; `trp.*` is Tropel's because tropel-sandbox implements it. `tropel-runtime` is a product in its own right — the API client is one consumer, and there will be others. Each downstream product **aliases** `trp` to its own name.

That makes aliasing a first-class, supported mechanism rather than a one-off, and it unblocks everything without waiting on the API client's product name.

```
trp.*            ← CANONICAL. Tropel's own API. Evolves with the runtime
  └─ <product>.* ← alias, set by each consumer (the API client, and anyone else)
pm.*             ← frozen compat: postman-runtime 7.56
bru.*            ← frozen compat: Bruno
```

> ### ⚠ The obligation this creates
> If third parties build on `tropel-runtime`, **`trp.*` is a semver-committed public API**, not an internal detail — breaking it breaks products you don't control. Same discipline as `tropel-sdk`: versioned reference docs, a published stability table, conformance tests. *"A product in itself"* is precisely what creates that obligation.

- [ ] **Parameterize the namespace in error messages.** `js/pm-api/pm.js` currently hardcodes `pm.` in **19** user-visible strings, e.g.
      ```js
      throw new Error('pm.response.json() — response body is not valid JSON or no response available');
      ```
      A user calling `wire.response.json()` must not see an error naming `pm`. Thread the configured namespace through when building the `trp` binding — don't inherit the hardcoding
- [ ] **True alias, not a proxy** — `globalThis.wire = trp`, one line, identical object. A proxy would allow per-product member renaming, which is a divergence trap
- [ ] **Alias configuration is part of the public API** — a third-party embedder needs a documented way to set it: `SandboxConfig { namespace: "trp", aliases: [...] }`, not a hardcoded global
- [ ] Install members via `Object.defineProperty(…, { writable: false })`, as `pm` does (`TROPEL_PARITY_POSTMAN.md` §3) — top-level reassignment then fails loudly instead of silently shadowing
- [ ] Publish a `trp.*` API reference, versioned independently of any consumer

### Shim updates without a Tropel release

**Every JS shim is `include_str!`'d into the binary** — `js/pm-api/pm.js` (1 291 lines) is embedded from four crates (`tropel-engine/src/js_bootstrap.rs:17`, `tropel-executor/src/runner.rs:1091,1193`, `tropel-input-k6/src/driver.rs:3034,3850`). So the release unit is the binary, and a separate repo would **not** decouple shim fixes from a Tropel release. It would also break those `include_str!` paths, which reach up out of each crate into the workspace root.

The decoupling that does work — most `pm.*`/`bru.*` fixes are JS-only:

- [ ] **Make the shim bundle injectable**
      ```rust
      pub struct ShimBundle(pub Vec<(&'static str, Cow<'static, str>)>);
      impl Default for ShimBundle { /* today's include_str! set */ }
      ```
- [ ] **Native / CLI keeps the embedded default** — reproducibility matters; a load test's semantics must not change because someone dropped a different `pm.js` beside the binary
- [ ] **The web client supplies its own** — a `pm.*` fix then ships as a JS asset with the web app: no wasm rebuild, no Tropel release
- [ ] Version the shim bundle independently of the engine, and surface both in the version handshake (P6)

> If Tropel releases feel expensive, automate them (tag → CI builds binary + npm + crates.io). Don't fragment the architecture around a slow release process.

---

`tropel-pm` fuses two things. Only one is Postman-specific:

| Layer | What it is | Postman-specific? |
|---|---|:--:|
| **State model** — `PmState` / `SharedPmState` | variable scopes, current exchange, assertion sink, `next_request`, abort state | **No** |
| **Binding** — `js/pm-api/pm.js` + `bridge_fns.rs` | `pm.test()`, `pm.response.*`, `pm.environment.set()` | Yes |

Bruno's API is a genuinely different *shape* — three objects (`bru.getEnvVar()` / `req.setHeader()` / `res.getBody()`) rather than one namespace — so the state model has to be binding-agnostic from the start, not `pm`-shaped with aliases bolted on.

```
tropel-script-state          scopes · exchange · assertions · flow control
   ├── bindings/tropel       tropel.*   ← CANONICAL
   ├── bindings/pm           pm.*       ← frozen compat: postman-runtime 7.56
   ├── bindings/bru          bru.* / req.* / res.*   ← frozen compat: Bruno
   └── (k6 already has its own, inside tropel-input-k6)
```

### `tropel.*` is canonical; `pm.*` is a compatibility layer, not an alias

The decisive reason is not branding — it's that **`TROPEL_PARITY_POSTMAN.md` proves Postman is silently wrong** in several places. Make `pm` canonical and you're married to those bugs forever. Make `tropel` canonical and both semantics are expressible:

```js
tropel.setNextRequest(null)   // stops the run — what every user expects
pm.setNextRequest(null)       // ends the iteration, continues — what Postman ACTUALLY does
                              // (its own docstring claims otherwise)
```

**The namespace becomes the compat switch.** That removes a chunk of what `API_CLIENT_PLAN.md` §5 designed as a global `compat: postman | strict` flag — keep the flag only for engine-level differences (script-composition order, jump caps) that no API call can express.

Second reason: Tropel has surface Postman doesn't — thresholds, load config, gRPC, WebSocket. `pm.thresholds` is absurd. You need your own namespace eventually regardless.

**Nothing is lost on adoption.** Users can still type `pm.*`, LLMs still emit working code, imported collections still run. It simply isn't the *documented* primary.

### Freeze the compat layers

- [ ] `tropel.*` — canonical, evolves with the product, correct semantics
- [ ] `pm.*` — **pinned to postman-runtime 7.56**. Reproduces Postman's bugs deliberately. **Never gains features.** Conformance-tested against `TROPEL_PARITY_POSTMAN.md`
- [ ] `bru.*` — pinned to Bruno's surface. Same rule

Compatibility layers must be frozen, not co-evolved — otherwise every feature ships twice and the two drift.

### Open decision — the canonical binding's name

The scripting API is shared between the load tester and the API client. **If the client ships under a different name, its users type `tropel.test()` in a tool not called Tropel.** Decide before launch; it's cheap now and expensive later.

- `tropel.*` — defensible, since `tropel-runtime` is the shared engine
- named after the API client, with the load tester inheriting it
- something product-neutral

A short alias (`tp.*`) alongside the full name is orthogonal and fine either way.

### Steps

- [ ] Split `tropel-pm` into `state` + `bindings/` **as modules first** — promote to separate crates only if it earns it
- [ ] Add the `tropel.*` binding; make `pm.*` a peer view over the same state, not the implementation
- [ ] Conformance test: `pm.*` behaviour vs `TROPEL_PARITY_POSTMAN.md`, including the bugs it must reproduce

---

## P4c · The missing native-format adapter

Converting an imported Postman collection to your own format **converts the container, not the contents** — the scripts inside are still JavaScript calling `pm.*`, and they cannot be mechanically rewritten (scripts build names dynamically and capture the object in closures). So `pm.*` support is permanent, and `tropel-input-postman` is not made redundant by the importer — it *is* the importer.

After the API client ships, three things coexist and none is redundant:

| Crate | Runs | Converts |
|---|---|---|
| `tropel-input-postman` | **once, at import** | Postman JSON → `Scenario` |
| `tropel-input-<native>` | **once, at load** | **your YAML → `Scenario` — this does not exist yet** |
| `tropel-pm` (→ `tropel-script-state`) | **every request, forever** | nothing — it *executes* |

- [ ] **Write `tropel-input-<native>`** once the API client's on-disk format is fixed (`API_CLIENT_PLAN.md` §3). Without it, Tropel CLI cannot run your own collections as load tests — which is the entire product thesis

---

## P5a · Retire `tropel-executor` → `tropel-runtime` + `tropel-scheduler`

**Retire the name `tropel-executor`.** It holds two unrelated concerns and therefore describes neither — which is exactly why splitting it felt arbitrary:

| New crate | From | Answers | Load-specific? |
|---|---|---|:--:|
| **`tropel-runtime`** | `runner.rs` | *what happens during one pass through a Scenario* — resolve, script, sign, send, assert, jump | **No** — this is also "click Send" |
| **`tropel-scheduler`** | `scheduler.rs` | *how many VUs, how fast, how long* — ramping, arrival rate, VU lifecycle | Yes, entirely |

Named after `postman-runtime`, which is the exact analogue — `newman` runs `postman-runtime`; `tropel-scheduler` and the API client both run `tropel-runtime`. (`tropel-exec` in earlier drafts was a bad name: one letter from `executor` and it says nothing.)

- [ ] **Create the two crates and rename the type** — `VURunner` → `ScenarioRunner`. There are no virtual users in an API client, so a type called `VURunner` in a shared crate is already wrong.
      ```bash
      cargo new --lib crates/tropel-runtime
      cargo new --lib crates/tropel-scheduler
      git mv crates/tropel-executor/src/runner.rs    crates/tropel-runtime/src/runner.rs
      git mv crates/tropel-executor/src/scheduler.rs crates/tropel-scheduler/src/scheduler.rs
      git commit -m "refactor: split tropel-executor into tropel-runtime + tropel-scheduler (pure move)"
      # then: delete tropel-executor, update workspace members, fix imports, rename the type
      ```
      `tropel-runtime` depends only on `tropel-sdk` + the pure-semantics crates + `tropel-auth`.

---

## P5b · The wasm build

- [ ] **Create `tropel-web`** — `wasm-bindgen` shim over `tropel-runtime` with a `DriverHttpClient` impl that awaits a host-provided JS `Promise`
      ```bash
      cargo new --lib crates/tropel-web
      ```
      ```toml
      [lib]
      crate-type = ["cdylib", "rlib"]

      [dependencies]
      tropel-exec = { workspace = true }
      wasm-bindgen = "0.2"
      wasm-bindgen-futures = "0.4"
      js-sys = "0.3"
      serde-wasm-bindgen = "0.6"
      ```

- [ ] **Handle the `Send` bounds.** `DriverHttpClient: Send + Sync` with `async_trait` boxes futures as `Send`, but `JsContext` is `!Sync` (`crates/tropel-executor/src/runner.rs:637`). On single-threaded wasm those bounds are pure friction:
      ```rust
      #[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
      #[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
      pub trait DriverHttpClient { /* ... */ }
      ```

- [ ] **Decide `pm.sendRequest` in the browser.** It needs a *synchronous* return inside a QuickJS host function, which cannot block in wasm. Options: Asyncify (≈2× code size, universal) · JSPI (cheap, Chromium-only) · unsupported in v1. **Everything else on the main path is already `async fn` and works natively in wasm32 — this is the only special case.**

- [ ] **Gates:**
      ```bash
      cargo check -p tropel-exec --target wasm32-wasip1
      cargo tree -p tropel-exec --edges normal --prefix none \
        | grep -E '^(reqwest|wasmtime|tokio)' \
        && { echo "FAIL: socket/host deps leaked into tropel-exec"; exit 1; } \
        || echo "PASS"
      ```

- [ ] **Build + size budget:**
      ```bash
      wasm-pack build crates/tropel-web --target web --release
      wasm-opt -Oz -o crates/tropel-web/pkg/tropel_web_bg.wasm \
                     crates/tropel-web/pkg/tropel_web_bg.wasm
      twiggy top -n 20 crates/tropel-web/pkg/tropel_web_bg.wasm

      # fail CI above a ceiling
      SIZE=$(stat -f%z crates/tropel-web/pkg/tropel_web_bg.wasm)
      echo "wasm size: $((SIZE/1024)) KiB"
      [ "$SIZE" -lt 8000000 ] || { echo "FAIL: wasm over budget"; exit 1; }
      ```

---

## P6 · Proof and packaging

- [ ] **Differential harness** — every fixture collection through native-driven and wasm-driven `tropel-exec`, diffing the full `IterationOutcome`. *This is what makes the one-engine claim verifiable rather than asserted.*
- [ ] **`@tropel/exec-wasm`** — published by Tropel's CI
      ```bash
      wasm-pack build crates/tropel-web --target bundler --release --scope tropel
      cd crates/tropel-web/pkg && npm publish --access public
      ```
- [ ] **Lockstep versioning** — one version stamped into the binary, the SDK, and the npm package by the same CI job
- [ ] **`tropel agent` subcommand** — so the API client repo carries zero Rust
- [ ] **Version handshake** — the client compares the connected agent's version against the loaded WASM's; mismatch → visible warning + load results marked unverified-parity

---

## P7 · Repo split — preserving commit history ✅ DONE

> **Done ahead of the original sequencing** — the plan deferred this until post-Phase-2, but doing it pre-release is the better trade: structural change is cheap now and expensive after launch.
>
> **Worth verifying the history actually survived**, since this is the one part that can't be fixed later without redoing the split:
> ```bash
> cd <tropel-sdk repo>
> git log --diff-filter=A --oneline -- src/types.rs
> ```
> Prints the commit that **added** the file. If it's the P1 inversion commit, history was truncated — re-run the extraction with the `filter-repo` invocation below, which names the pre-move paths. If it's the original creation of `types.rs`, you're good.
> ```bash
> git log --oneline -- src/traits.rs     # full pre-move history present?
> git log --oneline -- src/duration.rs   # ditto
> git log --oneline | wc -l              # should far exceed the SDK-only commit count
> ```
> If it *was* truncated: the monorepo still holds complete history, so nothing is lost — re-extract into a fresh repo and force-push, or accept it and add a README pointer to `transithq/tropel`.

Retained below for reference and for any future extraction (e.g. `tropel-sandbox`, should it ever warrant one).

### ⚠ `git subtree split` will not capture it

```bash
git subtree split -P crates/tropel-sdk -b sdk-only     # ← truncates history. Don't.
```

`subtree split` keeps commits touching files **currently at that path** and does **not follow renames**. P1 *moves the valuable files in* — `types.rs` (906 LOC) from `tropel-core`, `traits.rs` (638 LOC) from `tropel-ext`. Run it afterwards and you get the history of a 278-line re-export shim plus one commit where 1 800 lines appear from nowhere.

**The history you care about lives at `crates/tropel-core/src/types.rs` and `crates/tropel-ext/src/traits.rs`.** Any extraction must name the old paths explicitly. Since P1 is done, this is already true — go straight to `filter-repo`.

### The extraction

```bash
# NEVER in your working checkout — filter-repo rewrites history in place and
# deliberately drops the origin remote so you cannot push over the original.
git clone https://github.com/transithq/tropel /tmp/tropel-sdk-split
cd /tmp/tropel-sdk-split

git filter-repo \
  --path crates/tropel-sdk/ \
  --path crates/tropel-core/src/types.rs \
  --path crates/tropel-core/src/scenario.rs \
  --path crates/tropel-core/src/error.rs \
  --path crates/tropel-core/src/duration.rs \
  --path crates/tropel-ext/src/traits.rs \
  --path crates/tropel-ext/src/registration.rs \
  --path-rename crates/tropel-sdk/: \
  --path-rename crates/tropel-core/src/:src/ \
  --path-rename crates/tropel-ext/src/:src/
```

The three `--path-rename`s converge the pre-move and post-move locations onto the same final path, so `git log src/types.rs` shows the whole story with no `--follow` needed.

### Verify — this is the test that matters

```bash
git log --diff-filter=A --oneline -- src/types.rs
```

That prints the commit which **added** the file. If it's the P1 inversion commit, **history was lost — fix the paths and re-run.** If it's the original creation of `types.rs`, it worked.

```bash
git log --oneline | wc -l            # should far exceed the SDK-only commit count
git log --oneline -- src/traits.rs   # full pre-move history present
git log --oneline -- src/duration.rs # ditto — this is why P1 step 1 existed
```

### Push

```bash
git remote add origin git@github.com:transithq/tropel-sdk.git
git push -u origin master --tags
```

### Fallback

If full fidelity gets fiddly: `git subtree split` post-inversion plus a README line pointing at `transithq/tropel` for pre-split history. One command instead of a careful filter run. **The monorepo retains complete history permanently either way — the split repo is a derived artifact, so nothing is ever actually lost**, only harder to reach.

### Why this argues for deferring the split

Inverting *inside* the monorepo and splitting afterwards is what makes a clean extraction possible at all: the moves are ordinary in-repo `git mv` commits that filter-repo can trace. Split first and then move files in from outside, and they arrive as brand-new files with no history whatsoever — unrecoverable.

---

## Sequencing against `BACKLOG_V2`

| This work | Relative to the backlog |
|---|---|
| **P0–P3** (SDK inversion + publish) | Independent — take it now |
| **P4** (decouple) | Independent — take it now |
| **P5** (`tropel-exec`) | **Before any further `VURunner` work.** Phase 1 — script composition, variable-engine rewrite, `setNextRequest` — is all `VURunner` code. If Phase 1 is already done, P5 is a pure move; if any of it is still open, do P5 first or write it twice |
| **P6–P7** | After Phase 2 (the release gate) |
| `BACKLOG_V2` **Phase 0** (units, thresholds, metrics rollup) | Unaffected — metrics/engine layers. Parallel or first |

---

## Is this the right architectural call?

**Yes, on the substance.** Four independent reasons:

1. **Contract-at-the-bottom is the correct shape** — the same one `serde`, `http`, and `tower` use. A contract everyone agrees on should be a leaf; machinery builds on top, never underneath.
2. **It's required for the API client regardless of publishing.** The browser slice needs a types-and-traits crate with no `std::time`, no tokio, no sockets. The inversion produces exactly that as a side effect.
3. **It reduces publishing from three crates to one**, and stops `tropel-core`'s 1 010 lines of engine config becoming permanent public API.
4. **It's enforceable** — Gate 1 is a one-line check that can't silently regress. That matters: this crate already drifted into being unused once.

**Two caveats, neither fatal:**

- **P1 is a wide mechanical change** — moving `types.rs` out of `tropel-core` touches imports in all 27 crates. Low intellectual risk, high diff volume. One atomic commit, or the tree won't compile in between.
- **Publishing now means 0.x churn** — Phases 0/1/3 each break the contract. Pre-1.0 semver is designed for this; just don't call it stable.

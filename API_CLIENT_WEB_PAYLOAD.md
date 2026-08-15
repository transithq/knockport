# The web payload problem — 4–5 MB of wasm on a page load

**The question:** the website surface needs to be light, but `tropel_web.wasm` is 4–5 MB. How do Postman and others avoid this?

**The short answer:** they never had the problem, because their runtime was already JavaScript.

---

## §1 · Why Postman doesn't pay this cost

`postman-runtime` and `postman-sandbox` are **npm packages written in JavaScript**. Shipping them to a browser costs a few hundred KB of JS — maybe 100–150 KB gzipped. There was never an engine to compile.

Tropel's runtime is Rust plus **QuickJS**. In a browser that means shipping a *second* JavaScript engine, inside wasm, on top of the world-class one the browser already has. That is the entire structural difference, and it's the price of the one-engine guarantee.

### What each competitor actually does

| Tool | Scripts run | HTTP goes |
|---|---|---|
| **Postman Web** | client-side JS, in a sandboxed worker/iframe (`uvm`) | Desktop Agent for localhost/private networks; **Cloud Agent proxy** otherwise |
| **Hoppscotch** | client-side JS in a Web Worker | browser extension, or their `proxyscotch` proxy |
| **Insomnia / Bruno** | — | desktop only; no web payload problem to solve |

**The universal pattern: scripts run client-side, only the transport is proxied.**

### The distinction your question turns on

> *"are they routing the requests from frontend to backend and then through a proxy?"*

Two very different things get called that:

| | What transits your servers | Cost |
|---|---|---|
| **Transport proxying** — backend forwards the HTTP | request + response only | latency; no localhost; standard practice |
| **Execution offloading** — backend runs the whole pipeline | **credentials, variables, scripts, everything** | all of the above + you become custodian of customer secrets, and offline dies |

Postman's Cloud Agent is the first. **Do not do the second.** Your existing plan already has the right shape — extension as primary transport, cloud relay as the no-install fallback, native agent for localhost. That question is already answered; the payload question is separate.

---

## §2 · The fix, in order of leverage

### 1 · Lazy-load after first paint — biggest win, zero size work

The collection tree, request editor, environment panel, and history need **no wasm at all**. Render the UI, then fetch the wasm in the background.

A user who lands on the app spends the first several seconds navigating and picking a request. The wasm only has to be ready by the time they hit Send.

**This is an architecture decision, not a build flag, and it's worth more than every byte optimisation combined.**

### 2 · Un-embed the shims — `TROPEL_MODULARIZATION_REVIEW_R2.md` N1

`crates/tropel-web/src/bootstrap.rs:15-20` currently `include_str!`s all six shims into the wasm. Moving them to `@tropel/shims` (already published) removes ~150–250 KB from the data section **and** those bytes then compress as ordinary JS, cache separately, and update without a wasm rebuild.

### 3 · Two-tier wasm — the real structural answer

**Your crate split already enables this.** `tropel-sandbox` (QuickJS) is separate from `tropel-runtime`, so the browser bundle can be split the same way:

```
core.wasm       parse · variable resolution · auth signing · declarative assertions
                NO QuickJS                                   ~300–800 KB (measure)
                └─ loaded eagerly

script.wasm     QuickJS + sandbox + shims                    the bulk of the 4–5 MB
                └─ loaded ONLY when a request has a pre-request or test script
```

**Most requests in most collections have no scripts.** Those users never download QuickJS at all. The ones who do are power users who will tolerate a one-time load.

This is the highest-value thing on the list after lazy-loading, and it's cheap precisely because the crates are already split.

### 4 · Size discipline

```toml
[profile.release]
opt-level = "z"; lto = "fat"; codegen-units = 1; panic = "abort"; strip = true
```
```bash
wasm-opt -Oz --strip-debug
twiggy top -n 30        # measure before cutting — don't guess what's big
```

Also check whether QuickJS's `CONFIG_BIGNUM` is compiled in; dropping BigDecimal/BigFloat is free if no script needs it.

### 5 · Delivery

- **Brotli** — wasm compresses well, typically 3–4×. 4–5 MB → roughly 1.2–1.7 MB on the wire
- **`WebAssembly.instantiateStreaming`** — compiles during download, so time-to-ready ≈ download time
- **Cache aggressively** — immutable URL with a content hash; second visit is free

---

## §3 · If it's still too heavy — tier fidelity by surface

You have three surfaces with genuinely different constraints:

| Surface | Constraint | Engine |
|---|---|---|
| **Native app** (3 platforms) | none | full native `tropel-runtime` |
| **Extension** | installed once; Web Store review time scales with size | wasm is fine |
| **Website** | page load | the constrained one |

So a legitimate answer is: **the website runs scripts in the browser's own JS engine** — a Worker evaluating the *same* `@tropel/shims` files — and drops QuickJS from the web build entirely.

Why this is less bad than it first sounds:

- The shims are **literally the same files** (`pm.js`, `chai-shim.js`, `lodash-shim.js`). `pm.test`, chai assertions, lodash — identical behaviour.
- Everything that defines Tropel's semantics is **in Rust**: variable resolution, script composition order, `setNextRequest`, assertion collection, auth signing. Unchanged.
- The divergence is confined to the **JavaScript language** level — a script relying on QuickJS-specific behaviour.

And critically: **you would be the only tool in this category that can measure that divergence.** `crates/tropel-web/tests/native_vs_wasm.rs` already exists; extend it to a third leg running the host engine, and the fork becomes quantified rather than assumed. Postman ships the same class of trade with no instrumentation at all.

---

## §4 · Recommendation

**Do 1, 2, 4, 5 now.** They're cheap, uncontroversial, and probably sufficient — lazy loading alone likely removes the perceived problem.

**Measure, then decide on 3.** If the eager path can be held under ~1 MB brotli'd, the two-tier split is worth building. `twiggy` will tell you whether the non-QuickJS half is actually small enough to be worth separating.

**Hold §3 in reserve.** It's the escape hatch, not the plan — and it's a decision to make against a real number, not an estimate.

Do **not** offload execution to a backend. It solves a load-time problem by creating a credential-custody problem, and it takes offline and localhost with it.

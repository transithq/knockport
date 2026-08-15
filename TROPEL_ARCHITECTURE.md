# Tropel — architecture

**Reconstructed from the review set, not from source.** The repo isn't cloned locally. Sources: `TROPEL_CODE_FLOW.md` (@ `d73df78`, Jul 29) · `TROPEL_ARCH_REVIEW.md` (@ `acc81faa`, Jul 31) · `TROPEL_BACKLOG_V2.md` (@ `bae9b61e`, Aug 8) · `TROPEL_CHALLENGES.md` · `TROPEL_PARITY_{K6,POSTMAN}.md`.

Where those docs disagree, the newest wins — `CODE_FLOW`'s "🔴 stub" map is **stale**: QuickJS, `pm.*`, auth signing, thresholds, distributed, and gRPC were all live by Aug 8. Treat §7 here as the current state and §2–§6 as the design, which has been stable throughout.

---

## §1 · What Tropel is, in one paragraph

A Rust load-testing engine that runs **someone else's script format** — Postman collections and k6 scripts today, HAR/OpenAPI/subprocess besides — through **one execution core**, and reports k6-shaped metrics with thresholds as exit codes. It is not a k6 clone and not a Newman clone; it is the layer underneath both, with the input format as a pluggable front-end.

---

## §2 · Layer map

Read top to bottom. Each layer only knows the one below it.

```
   ┌──────────────────────────────────────────────────────────────┐
 A │  tropel (CLI)              clap · mimalloc · tracing         │
   │  args → JobConfig                                            │
   └──────────────────────────────┬───────────────────────────────┘
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
 B │  tropel-engine                                               │
   │  parse → schedule → iterate → aggregate → report             │
   └──────────────────────────────┬───────────────────────────────┘
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌─────────────┐        ┌──────────────┐        ┌──────────────┐
 C │ INPUT       │        │ EXECUTION    │        │ OUTPUT       │
   │ adapters    │        │ tropel-      │        │ tropel-      │
   │             │        │ executor     │        │ metrics      │
   │ postman     │        │              │        │ tropel-      │
   │ k6          │        │ VUScheduler  │        │ report       │
   │ har         │        │ worker pool  │        │              │
   │ openapi     │        │ VU loop      │        │ thresholds   │
   │ subprocess  │        │ Driver trait │        │ → exit code  │
   └──────┬──────┘        └──────┬───────┘        └──────▲───────┘
          │                      │                       │
          │  Scenario            │  Sample stream        │
          ▼                      ▼                       │
   ┌──────────────────────────────────────────────────────┴───────┐
 D │  RUNTIME SERVICES (what a VU actually calls)                 │
   │                                                              │
   │  tropel-js       QuickJS host (rquickjs)                     │
   │  tropel-pm       pm.* state bridge                           │
   │  tropel-native   crypto / hash / encoding / assert / json    │
   │  js/             chai · lodash · cryptojs · pm-api shims     │
   │  tropel-variables  {{var}} resolver + dynamic catalog        │
   │  tropel-http     client · auth signers · dns · rps · blocking│
   └──────────────────────────────┬───────────────────────────────┘
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
 E │  tropel-core — shared types only, no behaviour               │
   │  JobConfig · Scenario · Request · Response · Sample · Auth   │
   └──────────────────────────────────────────────────────────────┘
```

Plus, off to the side: `tropel-ext` (registry + `Driver` trait), `tropel-sdk` (stable surface for out-of-tree extensions), `tropel-wasm` (wasmtime **host** for guest plugins), `tropel-build` (`tropel build --with <crate>` → custom binary), `distributed/` (controller + agents).

---

## §3 · The one idea that makes it work: `Scenario`

Every input format is normalised into a single intermediate representation, and the executor knows *only* that IR.

```
Postman collection ─┐
k6 script ──────────┤
HAR ────────────────┼──▶  Scenario  ──▶  executor  (format-blind)
OpenAPI ────────────┤
subprocess stdout ──┘
```

```rust
Scenario {
  info: ScenarioInfo { name, description, schema },
  items: Vec<ScenarioItem>,          // recursive — folders nest
  variables: HashMap<String, Value>,
  auth: Option<AuthConfig>,
}

ScenarioItem {
  id, name,
  request:    Option<Request>,
  prerequest: Option<String>,        // JS source, not compiled here
  test:       Option<String>,        // JS source
  assertions: Vec<String>,
  items:      Vec<ScenarioItem>,     // folder children
}
```

Two consequences worth internalising:

1. **Adding a format is a parser, not an engine change.** That is the whole extensibility thesis.
2. **Scripts stay as *source strings* through parsing.** They're compiled per-VU at runtime, because a QuickJS-compiled function cannot cross threads (§5).

---

## §4 · How a run executes

```
tropel run collection.json --vus 500 --duration 5m

 CLI
  └─ JobConfig { input, execution, env, output, thresholds, http, tls }
      │
      ▼
 Engine::run
  ├─ 1. DETECT + PARSE
  │     registry.resolve_input(bytes)     ← each adapter's detect()
  │     adapter.parse(bytes) → Scenario   (Arc — shared by every VU)
  │
  ├─ 2. SET UP SHARED STATE
  │     HttpProtocol · MetricsCollector · VUScheduler
  │     stop_signal (level-triggered AtomicBool) · shared-iteration counter
  │
  ├─ 3. SCHEDULE  [tropel-executor]
  │     match ExecutionConfig:
  │       ConstantVus         spawn N, sleep(duration), stop, join
  │       RampingVus          precomputed step table → spawn/retire to target
  │       SharedIterations    N VUs draining one shared counter
  │       ConstantArrivalRate open model — rps.rs CAS loop paces arrivals
  │
  ├─ 4. VU LOOP  (per VU, on a worker thread — see §5)
  │     loop {
  │       select! { stop.notified() => break, run_iteration(..) => {} }
  │     }
  │
  ├─ 5. AGGREGATE
  │     Sample ──mpsc──▶ single-writer collector ──▶ hdrhistogram per series
  │
  └─ 6. REPORT + GATE
        thresholds evaluated against real metrics → exit code
        reporters: stdout · json · csv · prometheus · statsd · json_stream
```

### Inside one iteration (the Postman driver)

```
run_iteration(scenario, vu_id, iteration)
 │
 ├─ build VariableScope   { data, env, collection, globals, local }
 │                          ← five layers, precedence per Postman
 ├─ walk items (recursive, folders honoured)
 │   │
 │   ├─ PRE-REQUEST SCRIPTS
 │   │    gather listeners: collection → outer folder → … → request
 │   │    run each in the VU's QuickJS context, sequentially
 │   │    (pm.variables carries forward between scripts AND requests)
 │   │
 │   ├─ RESOLVE  {{var}} across url + headers + query + body + auth
 │   ├─ SIGN     auth signer (Bearer/Basic/ApiKey/Digest/OAuth1/OAuth2/SigV4/Hawk)
 │   ├─ SEND     tropel-http → reqwest
 │   ├─ RECORD   Sample{ http_req_duration, http_reqs, … + tags }
 │   │
 │   ├─ TEST SCRIPTS
 │   │    same additive gather; chai assertions → checks metric
 │   │
 │   └─ FLOW     setNextRequest → jump within this iteration
 │                (Tropel adds a per-iteration jump cap; Postman has none)
 │
 └─ emit iteration_duration
```

The **`Driver` trait** is what lets a k6 script take a different shape here — its iteration is "call the module's default export", not "walk items" — while reusing the same scheduler, HTTP stack, metrics, and thresholds.

---

## §5 · The threading model — this is the part that matters

Almost every hard bug in the review set is a consequence of one fact:

> **QuickJS is single-threaded and `!Send`. HTTP is async and multi-threaded.**

### The shape

```
Process
│
├── Worker threads  (≈ one per core)
│   │
│   └── each runs a **current-thread** tokio runtime
│       │
│       └── multiplexes MANY VUs on that one thread
│           │
│           └── each VU owns, privately:
│                 · its own QuickJS Runtime + Context   (!Send — can't move)
│                 · its own HttpClient
│                 · its own driver instance
│               → no cross-VU locking, no shared JS heap
│
├── io_rt  — a SEPARATE multi-thread runtime, ONLY for host I/O futures
│
└── collector thread — single writer behind an mpsc
```

VU density comes from **many VUs per thread**, not a thread per VU. That is the right call — it's how you get to 10k VUs without 10k OS threads.

### The bridge problem

A script calls `pm.sendRequest(...)`. You are inside `ctx.with(...)` on a current-thread runtime, and you must return a value **synchronously** to JS. So:

- `Handle::current().block_on(fut)` → **panics.** "Cannot start a runtime from within a runtime" is a thread-local guard; it doesn't care *which* runtime you name.
- `futures::executor::block_on(fut)` → **deadlocks.** The future needs the very reactor you just parked. reqwest's own timeout can't even fire.

The resolution is `tropel-http/blocking.rs`:

```rust
pub fn execute_blocking(client: HttpClient, req: Request) -> Result<Response> {
    let (tx, rx) = sync_channel(1);
    io_rt().spawn(async move { let _ = tx.send(client.execute(&req, None).await); });
    rx.recv()...   // plain std channel park — no runtime entered here
}
```

Spawn onto a **different** runtime's threads; park the caller on a plain `std` channel. No runtime is entered on the calling thread → no panic. The future runs on `io_rt`'s reactor → no deadlock.

**Every host function that does I/O must go through this one helper.** The bug recurred (`pm.sendRequest`, then again in the k6 driver) purely because the logic was hand-rolled twice.

### The cost, stated honestly

`execute_blocking` **parks the VU's worker thread** while the request is in flight — which stalls every peer VU multiplexed onto that same current-thread runtime. Correct, but it caps density.

The density-preserving fix is an **async host bridge**: return a JS `Promise`, register the reqwest future with a per-VU event loop, and drive the QuickJS job queue between awaits so the VU yields cooperatively. k6 gets its synchronous-looking `http.get()` from goroutine yielding; the Rust analogue is that event loop. **This is the largest open architectural question in the project.**

---

## §6 · Extensibility — four tiers

Deliberately layered by cost, from `TROPEL_CHALLENGES.md`:

| Tier | Mechanism | Hot-path cost | For |
|---|---|---|---|
| **0 · Declarative** | adapter parses a format → `Scenario`, once | **zero** — parse happens before the run | HAR, OpenAPI, Postman, anything static. *Push everything possible into this lane.* |
| **1 · Native** | Rust crate, statically linked via `tropel build --with` | none (direct call) | trusted first-party drivers |
| **2 · WASM** | wasmtime guest, AOT `.cwasm`, fuel-metered, pooling allocator | ns-scale boundary, dwarfed by the network | **untrusted third-party** plugins |
| **3 · Subprocess** | stdin/stdout to any binary | process + pipe per invocation | any language, escape hatch |

Native `.so`/`.dylib` was explicitly **rejected**: no stable Rust ABI, no sandbox, panic-across-FFI is UB, per-OS build matrix. Static linking beats it for trusted code, WASM beats it for untrusted — dominated on both ends. Precedent: Envoy, Fastly, Shopify, Extism all landed on WASM.

Registration is via the `inventory` crate — an adapter declares itself and appears in the registry with no central list to edit.

> ⚠ **Naming trap.** `tropel-wasm` is the **host** that runs guest plugins (tier 2). Compiling *Tropel itself* to `wasm32` for the browser is the opposite direction and a different crate. See §8.

---

## §7 · Where it actually stands (Aug 8, `bae9b61e`)

**Working and genuinely good:** collection parsing · variable resolution with fixpoint termination · all 8 auth schemes with published vectors independently reproduced · QuickJS + `pm.*` + chai · thresholds incl. tag-scoped filtering · the single-writer metrics aggregator · hdrhistogram merge · `rps.rs`'s CAS pacing loop · distributed controller/agents with exact merged-count assertions · gRPC over real HTTP/2 · the adapter registry and `Driver` dispatch shape.

**Open, by theme** (per `BACKLOG_V2` §00):

| Phase | Theme |
|---|---|
| 0 | **Units confusion** — one root cause, five wrong numbers. `http_req_duration` composition. Threshold stat resolver. |
| 1 | **The wedge** — Postman script composition (folder scripts currently never run), the variable engine rewrite, `setNextRequest` semantics. |
| 2 | **Safety** — WASM `.cwasm` cache authentication (an RCE), fd exhaustion, OpenAPI `$ref` blow-up, `env.sleep` clamp. *Release gate ends here.* |
| 3 | k6 scripts running unmodified — HTTP in `setup()`/`teardown()` is the biggest gap. |
| 4–5 | Performance, then breadth. |

The recurring failure *pattern* to watch: **fail-open resolvers sitting one layer below a fail-closed validator** — the validator rejects the bad input, then something underneath quietly accepts it anyway.

---

## §8 · The slice that becomes the API client's core

> **Correction to an earlier draft of this section.** It listed `tropel-metrics` as part of the browser slice. That's wrong. A load engine and an API client want *opposite* things from a request — the engine discards response bodies to survive 10k VU; the client must retain every byte. Aggregation is **native-only** and never ships to the browser. See `TROPEL_EXEC_SPLIT.md` for the full argument and the refactor.

The shared layer is not the engine. It's the layer **below** the engine: a pure function of **one** request.

```
resolve {{vars}} → pre-scripts → sign auth → [SEND] → test-scripts → assertions → captures → next-request
```

No metrics, no VUs, no pacing, no clock, no sockets. That is `tropel-exec`, and it is what must be byte-identical everywhere. Everything above it — how many times you run it, how you pace it, how you fold results — is the load engine, and is not the API client's business.

```
                     tropel-exec
               (one request · pure · resumable)
                     ↑          ↑
            ┌────────┘          └────────┐
      tropel-engine                  api client
      VUs · pacing · histograms      call once · keep everything
      thresholds · reporters         (via @tropel/exec-wasm)
```

Both depend on it. Neither depends on the other.

| In `tropel-exec` (browser-safe) | Stays native-only |
|---|---|
| `tropel-collection` — parser | `tropel-http::client` — sockets, pooling, DNS |
| `tropel-variables` — `{{var}}` | `tropel-executor` — worker pool, threads |
| `tropel-js` — QuickJS | `tropel-metrics` — histograms, thresholds |
| `tropel-pm` — `pm.*` state | `tropel-report` — reporters |
| `tropel-native` — crypto/hash/assert | `tropel-wasm` — wasmtime, can't target wasm32 |
| `js/` — chai · lodash · pm-api shims | `tropel-build` — spawns cargo |
| `tropel-auth` — signers, **extracted** from `tropel-http` | `distributed/` — network topology |

`tropel-exec` is a **resumable state machine**, not a function that calls HTTP. It yields `Send(request)`; the host performs the send however it likes; it is resumed with the response. That single shape buys three things at once:

- **Browser:** no sync-over-async on the common path → no SharedArrayBuffer → no COOP/COEP → no Asyncify tax.
- **Tests:** drive it with canned responses, zero network.
- **Native:** it can be driven by a plain async loop — which *is* the density-preserving fix §5 says is still open. No `execute_blocking`, no parked VU threads, no stalled peers.

The one case it doesn't cover: **`pm.sendRequest` performs I/O *inside* a stage**, so yielding at a stage boundary can't express it. That needs Asyncify (≈2× code size, universal) or JSPI (cheap, Chromium-only for now). Every other path avoids it.

And the irony worth keeping: §5 exists entirely because QuickJS is `!Send` while the host is multi-threaded. A Web Worker is single-threaded by construction, so that whole problem evaporates. **The browser build is the easy target; native is the hard one.**

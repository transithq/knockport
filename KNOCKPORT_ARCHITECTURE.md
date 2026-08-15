# Knockport — architecture & build plan

**One React app. Three execution hosts. One engine from *Send* to 10 000 VU.**

Knockport is an API client built on the Tropel runtime. Web, browser extension, and native desktop share a single UI codebase and a single request pipeline — the only thing that changes per surface is *where* that pipeline runs and *how* bytes reach the network.

**Depends on:** `TROPEL_ARCHITECTURE.md` · `TROPEL_COMPONENT_MAP.md` · `API_CLIENT_WEB_PAYLOAD.md` · `TROPEL_MODULARIZATION_TODO.md`

---

## §1 · Positioning

| | Got right | Got wrong |
|---|---|---|
| **Postman** | `pm.*` — the de-facto scripting standard · huge import surface · collection runner + Newman · visualizer · codegen | cloud-locked, login forced, Scratchpad removed · one opaque JSON blob per collection → unreviewable diffs · bloated and slow · load testing is capped and threshold-less · **no plugin system** |
| **Bruno** | filesystem-first, git-native, PR-reviewable · offline by default, no account · secrets in `.env` · native CLI | proprietary `.bru` format · **GUI and CLI use different JS sandboxes** → scripts behave differently · "developer mode" runs unrestricted Node · weak collaboration · no load testing · no plugins |
| **Hoppscotch** | genuinely fast and light · **broadest real-time protocol support** — WS, SSE, Socket.IO, MQTT, GraphQL subscriptions · keyboard-driven, command palette · self-hostable | thin scripting · weak collection runner · limited offline · no load testing · no plugins |

**The pattern in every right-hand column:** each has a *runtime-semantics fork* and *no extension model*. Postman's sandbox docstring contradicts its own runtime; Bruno's GUI ≠ its CLI; Hoppscotch's scripting is a different thing again.

### The thesis

1. **The collection is a file.** YAML on disk, git-native, byte-stable.
2. **The runtime is one engine.** `tropel-runtime` compiled once, running in the browser (wasm), the extension, the desktop app (native), and the load cluster — with a differential harness proving they agree.
3. **Everything else is a plugin.** Importers, visualizers, codegen, auth providers, protocols — first-party features built on the same API third parties get.

Nobody ships all three. Nobody ships #3 at all.

---

## §2 · Surfaces and the execution ladder

```
                    ┌──────────────────────────────────┐
                    │   ONE React + TypeScript app     │
                    │   packages/ui — shared verbatim  │
                    └───────────┬──────────────────────┘
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   ┌─────────┐            ┌──────────┐            ┌───────────┐
   │   WEB   │            │EXTENSION │            │  DESKTOP  │
   │  Vite   │            │   WXT    │            │  Tauri 2  │
   └────┬────┘            └────┬─────┘            └─────┬─────┘
        │                      │                        │
  pipeline: wasm         pipeline: wasm           pipeline: NATIVE
  transport: relay       transport: SW fetch      transport: Rust reqwest
                         (host_permissions)        (no wasm at all)
```

**Execution location is per-transport, not global** — the pipeline is the same Rust code, compiled two ways.

| Tier | Install | Fetch path | localhost | Relay needed | wasm shipped |
|---|---|---|:--:|:--:|:--:|
| **1 · Web** | none | **relay** — CORS makes a page fetch impossible | no | **yes** | yes |
| **2 · Extension** | one click | SW fetch, `host_permissions` — no CORS | **yes** | **no** | yes |
| **3 · Desktop** | app | Tauri Rust core, `tropel-runtime` linked natively | **yes** | **no** | **no** |

Zero-install users get tier 1 and a working product. The extension is a one-click upgrade that unlocks localhost and removes us from the path — **Postman's equivalent upgrade is a desktop application install.**

*Deferred optimisation:* targets that send permissive CORS headers could be fetched straight from the page, skipping the relay. Worth doing once relay bandwidth is measurable, not before — it's a cost optimisation, not a capability.

### Why Tauri, not Electron

- The frontend is already React/TS — shared verbatim with web and extension
- The backend is **Rust**, so it links `tropel-runtime` directly: no wasm, no relay, full subtimings, real connection pooling, mTLS, gRPC
- ~10 MB binaries vs Electron's ~100 MB — Postman, Bruno and Insomnia all pay the Electron tax
- Tauri 2 opens mobile later without a second UI

---

## §3 · Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| UI | React + TypeScript + **Vite** |
| Styling | **Tailwind v4** + **shadcn/ui** (copy-in — no component dependency) |
| State | **Zustand** (UI) + **Dexie `useLiveQuery`** (data). No Redux — there's no server to query |
| Editor | **CodeMirror 6** — `lang-json`, `lang-javascript`, `lang-graphql`, `lint`, `merge` |
| Storage | **Dexie** (IndexedDB) for metadata · **OPFS** for bodies/HAR · **File System Access API** for real on-disk collections |
| Virtualization | TanStack Virtual |
| Layout | `react-resizable-panels` |
| Command palette | `cmdk` |
| Desktop | **Tauri 2** (Rust core links `tropel-runtime`) |
| Extension | **WXT** (MV3, cross-browser incl. Firefox) |
| Engine | `@tropel/runtime-wasm` + `@tropel/shims` (npm) · `tropel-runtime` crate (desktop) |
| Wasm↔JS | **postcard** over shared buffers — not JSON |
| Lint/format | **Biome** — one binary |
| Tests | Vitest · Playwright (persistent context loads MV3) · `cargo test` |
| CI | GitHub Actions |

---

## §4 · Repo layout

```
knockport/
├─ apps/
│  ├─ web/                  Vite SPA
│  ├─ extension/            WXT — SW transport, DNR header rewriting, capture
│  ├─ desktop/              Tauri 2 shell + Rust core
│  └─ relay/                the zero-install transport/execution service
├─ packages/
│  ├─ ui/                   ALL React components — shared by all three surfaces
│  ├─ core/                 domain model, collection format, TS types
│  ├─ transport/            one interface: direct | relay | extension | tauri
│  ├─ engine/               @tropel/runtime-wasm wrapper + Worker host
│  ├─ plugin-host/          sandboxed plugin runtime + capability broker
│  ├─ plugin-api/           the public plugin SDK (published to npm)
│  └─ format/               YAML (de)serializer, byte-stable
└─ plugins/                 first-party plugins, built on the public API
   ├─ import-postman/  import-openapi/  import-har/  import-bruno/  import-curl/
   ├─ codegen/  visualizer-charts/  auth-oauth2/  proto-grpc/
```

**Rule: `packages/ui` never imports from `apps/*`.** Every surface-specific capability arrives through `packages/transport`.

---

## §5 · The collection format

Bruno was right that collections must be files, and wrong to invent a language. **YAML.** Universal tooling, hand-editable, every importer can target it.

```
my-api/
├─ knockport.yaml              name, collection auth + scripts + vars
├─ environments/{staging,prod}.yaml
└─ requests/
   ├─ folder.yaml              folder auth + scripts + explicit order
   └─ auth/{folder.yaml, login.yaml, refresh.yaml}
```

```yaml
# requests/auth/login.yaml
name: Login
method: POST
url: "{{baseUrl}}/v1/auth/login"
headers: { Content-Type: application/json }
body:
  type: json
  content: |
    { "email": "{{email}}", "password": "{{password}}" }
auth: { type: inherit }

scripts:
  pre:  |
    kp.variables.set("nonce", Date.now());
  test: |
    kp.test("200", () => kp.response.to.have.status(200));
    kp.collectionVariables.set("token", kp.response.json().token);

assert:                       # declarative — no JS needed for the common case
  - status == 200
  - jsonpath("$.token") exists
  - responseTime < 500

load:                         # ← the moat, colocated with the request
  vus: 500
  duration: 5m
  thresholds:
    - http_req_duration p(95) < 800
    - checks rate > 0.99
```

**Three rules that make or break the git story:**

1. **Byte-stable serialization** — stable key order, LF, no trailing whitespace, no regenerated ids. A no-op save must produce an identical file. *Postman fails this, which is why its diffs are useless.*
2. **Ordering lives in `folder.yaml`** as an `order: [...]` list — not a `seq:` in every file. Bruno's approach conflicts in N files when you reorder N requests.
3. **Secrets are references, never values** — `{ from: env | keychain, key: ... }`. A `secret:` resolving to an inline literal is a lint error enforced pre-write.

---

## §5b · The relay

**Scope: API client only.** No load testing through it — that changes the cost model by orders of magnitude and is deliberately out until later.

### Build it on `tropel-http`

The relay is a thin Axum service wrapping the `tropel-http` client. Not a new proxy:

- **Full header control** — `Host`, `Cookie`, `User-Agent`, `Content-Length`. A generic edge-function `fetch()` restricts several of these
- **Identical HTTP semantics** to the desktop and load-runner paths — redirects, cookie jar, timeouts, auth signers. Parity for free
- **SSRF protection already written and tested** — Tropel's `blacklistIPs` CIDR handling is verified across `/0`, `/31`, `/32`, `/127`, `/128`, and v4-mapped addresses, and is re-checked per redirect hop (`BACKLOG_V2` §9)
- Grows into the execution-offload service, and later the load runner, without a rewrite

### Cost

API-client traffic is manual and bursty — a heavy user might make ~500 requests/day averaging tens of KB. Bandwidth dominates; compute is negligible for an I/O-bound proxy.

| Scale | Rough egress | On Hetzner/Fly | On AWS |
|---|---|---|---|
| 1 000 active users | ~750 GB/mo | ~$10–15 | ~$65 |

Not a real cost at this stage. **The thing that would break it is load testing**, which is exactly why it's excluded.

### Abuse is the actual risk

An open relay is an SSRF vector, a spam amplifier, and an IP-block bypass. Non-negotiable before it's public:

- [ ] Private / loopback / link-local / metadata-endpoint IP blocking, re-checked per redirect (reuse Tropel's)
- [ ] Per-session and per-IP rate limits
- [ ] Request-size, response-size, redirect-count and timeout caps
- [ ] Lightweight session token — stops drive-by use as a generic proxy
- [ ] **Zero request logging.** Metrics only: counts, sizes, durations. Never URLs, headers, or bodies
- [ ] Publish that policy — the relay sees users' credentials in transit, and saying so plainly is the difference between trusted and not

---

## §6 · Scripting

**`kp.*` is the documented API. That's the whole surface for v1.**

| Binding | Status |
|---|---|
| **`kp.*`** | **the API.** Knockport's alias of the runtime's canonical `trp.*` |
| `trp.*` | the runtime's own name — works, undocumented here |
| `pm.*` · `bru.*` | present but **undocumented and unadvertised** |

### On `pm.*` — it already works, whether or not you document it

`tropel-web/src/bootstrap.rs` already embeds `pm.js` and `bru.js` alongside the rest. So the decision to hold `pm.*` back is a **docs and positioning choice, not a build one** — and imported Postman collections will silently keep working, which is the outcome you want anyway.

Two consequences worth being deliberate about:

- **Postman import is only useful because `pm.*` runs.** Scripts in an imported collection call `pm.*` and cannot be mechanically rewritten — they build names dynamically and capture the object in closures. So the shim is permanent, not transitional. Not advertising it is fine; removing it would break the importer.
- **It pairs with the shim un-embedding work** (`TROPEL_MODULARIZATION_REVIEW_R2.md` N1). Once shims load from the host rather than `include_str!`, the web bundle can ship `kp` + chai only and fetch `pm.js` / `bru.js` on demand when an imported collection needs them. Smaller default bundle *and* the positioning you want, from one change.

When `pm.*` is eventually documented, the namespace becomes the compat switch — `kp.setNextRequest(null)` stops the run, `pm.setNextRequest(null)` ends the iteration, which is what Postman actually does despite its own docstring.

Sandbox is **safe by default**: QuickJS with fuel metering, no filesystem, no `require` unless explicitly granted per collection. Bruno's developer mode runs unrestricted Node; being the safe default is a position worth taking.

---

## §7 · The plugin system — the real differentiator

**None of Postman, Bruno, or Hoppscotch has a working plugin model.** Insomnia's was the closest and it withered. This is open ground.

Two tiers, deliberately separate:

```
┌─ APP PLUGINS ─ JS/TS, sandboxed Worker ───────────────┐
│  importer · exporter · visualizer · codegen           │
│  auth-provider · request-hook · panel · theme         │
│  → npm: knockport-plugin-*                            │
└───────────────────────────────────────────────────────┘
┌─ ENGINE PLUGINS ─ Rust/WASM via tropel-sdk ───────────┐
│  input adapter · protocol · driver · output           │
│  → crates.io, or a .wasm guest                        │
└───────────────────────────────────────────────────────┘
```

### App plugin contract

```ts
// knockport.plugin.ts
export default definePlugin({
  id: "acme.snapshot-diff",
  capabilities: ["read:response", "ui:panel"],   // ← declared, brokered, revocable
  contributes: {
    panels:      [{ id: "diff", title: "Snapshot", icon: "git-compare" }],
    visualizers: [{ match: "application/json", render: renderDiff }],
  },
});
```

**Non-negotiables, all of them lessons from other ecosystems:**

- **Runs in a Worker, never the main thread.** A plugin cannot freeze the UI or read the DOM.
- **Capability-based permissions**, declared in the manifest and brokered by the host. `read:collections` ≠ `read:secrets` ≠ `net:*`. Secrets are opt-in and prompted.
- **No ambient network.** A plugin wanting HTTP goes through the same transport interface, so it's logged, proxied, and policy-checked like everything else.
- **Versioned API with deprecation windows.** The reason Insomnia's ecosystem died.
- **First-party features ship as plugins.** Every importer, the codegen, the chart visualizer. If the API can't express them, it isn't good enough — the VS Code lesson.

### Distribution without a registry

A curated registry is deferred. **Installation is not** — plugins must be buildable and installable from day one, and three sources cover everything a registry would except discovery:

| Source | Surface | Mechanism |
|---|---|---|
| **npm package name** | all | `knockport-plugin-*` convention, fetched from a CDN (unpkg/jsdelivr) at install time and cached locally |
| **Local folder / file** | desktop, extension | point at a directory, or drop a `.zip` |
| **URL** | all | direct link to a built bundle |

Discovery starts as a curated markdown list in the docs. Promote to a real registry only if the ecosystem earns it — and note that the manifest, capability model, and versioned API are what actually matter. A registry is a lookup table on top of them, and it's trivial to add later.

- [ ] `create-knockport-plugin` scaffold — the thing that decides whether anyone ever writes one
- [ ] Ship 5+ first-party plugins on the public API before opening it up; if they need private hooks, the API isn't done

---

## §8 · Feature plan

### From Postman
`pm.*` compat · five variable scopes with correct layering · collection runner with CSV/JSON iteration data · imports (Postman v2.1, OpenAPI 3.x, Swagger 2.0, cURL, HAR, Insomnia, Bruno, `.http`, GraphQL introspection) · codegen via httpsnippet · response visualizers · mock server from a collection

### From Bruno
Directory-tree collections on real disk · no account, ever, for the core product · no telemetry by default · secrets via `.env` + OS keychain · native CLI (`kp run`, `kp load`) — nearly free, it's `tropel-runtime` plus arg parsing

### From Hoppscotch
**Full real-time protocol coverage** — WebSocket, SSE, Socket.IO, MQTT, GraphQL subscriptions · keyboard-first with a command palette · self-hostable relay · genuinely fast

### Ours alone
- **Collection → load test** in one click. Thresholds as CI exit codes. Same collection, same scripts, same assertions
- **Diff view** over the file format (CodeMirror merge) — "review the API changes in this PR" as a first-class flow
- **Response snapshots** — save a golden response, re-run, diff. Contract testing without a second tool
- **A real plugin system** (§7)
- **OpenAPI drift detection** — spec ↔ collection, both directions
- **Runtime parity is provable** — `native_vs_wasm` in CI, published as a badge
- **Scale** — virtualized tree + lazy per-folder load + Dexie indexes. Target: a 50 000-request collection opens in under a second

### Deliberately not built
Cloud workspaces · proprietary sync · monitors · docs hosting · accounts for core features · AI chat. That list is how Postman got slow, and none of it is why anyone picks a tool. Sync, if it ships, is a thin layer over the file format — because git already implements it.

---

## §9 · TODO

### M0 · Foundations
- [ ] Scaffold monorepo — pnpm + Turborepo, Biome, Vitest, Playwright
- [ ] `packages/format` — YAML serializer with the three byte-stability rules + property tests for round-trip identity
- [ ] `packages/core` — domain model, TS types generated from `tropel-sdk`'s schema where possible
- [ ] `packages/transport` — the interface, plus the `direct` implementation
- [ ] Storage: Dexie schema + OPFS body store + File System Access adapter
- [ ] Decide the relay's hosting shape and cost model **(blocks M1)**

### M1 · Send
- [ ] `packages/ui` shell — panels, command palette, theming
- [ ] Request editor: method/URL/params/headers/body/auth (CodeMirror 6)
- [ ] Response viewer: pretty/raw/preview/headers/timings
- [ ] `apps/relay` — transport-relay mode first, execution-offload second
- [ ] `apps/web` wired to `direct` + `relay`
- [ ] History, persisted

### M2 · Collections
- [ ] Virtualized tree, lazy per-folder load
- [ ] Read/write collections on real disk (File System Access), OPFS fallback
- [ ] Environments + variable scopes UI, secrets as references
- [ ] Importers as **plugins** — Postman, OpenAPI, cURL, HAR, Bruno, Insomnia
- [ ] Migration report on import: *"3 places where this collection relies on Postman behaviour we corrected"*

### M3 · Scripting
- [ ] `packages/engine` — `@tropel/runtime-wasm` in a Worker, postcard ABI
- [ ] Lazy-load the wasm **after first paint** — never blocks initial render
- [ ] `kp.*` alias wired; `pm.*` / `bru.*` compat verified against the parity docs
- [ ] Script editor with type hints for `kp.*`
- [ ] Two-tier wasm if `twiggy` says the non-QuickJS half is worth splitting

### M4 · Plugin host — early, so first-party features dogfood it
- [ ] `packages/plugin-host` — Worker sandbox + capability broker
- [ ] `packages/plugin-api` — published to npm, semver-committed
- [ ] Port M2's importers onto the public API
- [ ] Plugin manifest, install/enable/disable UI, permission prompts
- [ ] `create-knockport-plugin` scaffold

### M5 · Runner
- [ ] Collection runner: flow control, `setNextRequest`, data-driven iteration
- [ ] Diff view over the file format
- [ ] Response snapshots + contract diffing
- [ ] `kp` CLI — `run`, `load`, `--bail`, JUnit reporter

### M6 · Extension
- [ ] WXT scaffold; SW as transport behind the same interface
- [ ] **Forbidden-header rewriting via `declarativeNetRequest`** — the P0 spike; if this fails, the extension tier is capability-limited
- [ ] Traffic capture → save as request (the Requestly idea — best onramp in the category)
- [ ] `externally_connectable` so the web app talks to it directly
- [ ] Extension-detected → load wasm; not detected → relay

### M7 · Desktop
- [ ] Tauri 2 shell hosting `packages/ui` unchanged
- [ ] Rust core links `tropel-runtime` natively — no wasm on this surface
- [ ] localhost, mTLS, client certs, real subtimings
- [ ] Signed builds + auto-update for macOS / Windows / Linux

### M8 · Protocols
- [ ] WebSocket, SSE, Socket.IO, MQTT, GraphQL subscriptions
- [ ] gRPC via `tropel-x-grpc` — reflection + `.proto` upload
- [ ] Streaming response UI

### M9 · Load testing
- [ ] `load:` block editor + threshold builder
- [ ] Dispatch to the native agent (desktop) or the cloud runner
- [ ] Live metrics streaming, threshold pass/fail as the verdict
- [ ] **In-browser is a "dry run" only** — pass/fail and error counts, **never percentiles**. A browser measures its own message bus, not your API

### M10 · Collaboration
- [ ] Git-native flow: branch, diff, PR-review a collection
- [ ] Optional sync — a thin layer over the file format, never a replacement for it

---

## §10 · Decisions

### Settled

| | |
|---|---|
| **Relay scope** | API client only. No load testing through it — that's what would make the cost model hard |
| **Relay implementation** | Rust/Axum over `tropel-http` — full header control, semantic parity, SSRF protection already written |
| **Web transport** | relay, always. Direct fetch is a later cost optimisation, not a capability |
| **Extension / desktop** | no relay. Extension uses `host_permissions`; desktop runs `tropel-runtime` natively |
| **Scripting API** | `kp.*` only. `pm.*` / `bru.*` present but undocumented (they already ship in the bundle) |
| **Plugin registry** | deferred. Install from npm name, local folder, or URL — that covers everything but discovery |

### Still open

| Decision | Blocks | Note |
|---|---|---|
| **Two-tier wasm** | M3 | Decide against a `twiggy` measurement, not an estimate |
| **DNR forbidden-header spike** | M6 | If it fails, the extension can't set `Host`/`Cookie`/`User-Agent` and tier 2 becomes capability-limited. **Spike this before committing to the extension tier's promises** |
| **Relay hosting region/provider** | M1 | Cost is small at this scale; latency to users matters more than price |

---

## §11 · The pitch

- **Postman** gave you a runtime but locked it in the cloud and made the storage unreadable.
- **Bruno** gave you files but not a runtime, and its GUI disagrees with its own CLI.
- **Hoppscotch** gave you speed and protocols but almost no scripting.
- **None of them lets you extend it.**

**Knockport** gives you files, one provable runtime, every protocol, a real plugin system — and the same engine from *Send* to 10 000 VU.

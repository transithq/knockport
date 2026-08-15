# KnockPort — Project TODO & Handoff Guide

> **For the next agent:** Read this file + `KNOCKPORT_ARCHITECTURE.md` before writing any code.
> The architecture doc is the source of truth for design decisions; this file tracks status and
> gives concrete, file-level next steps. Commit messages must NOT contain AI/agent attribution.

## 0 · Project in one paragraph

KnockPort is a fast, light API client (Postman/Bruno/Hoppscotch category). Monorepo:
pnpm workspaces + Turborepo. Frontend = React 19 + Vite + Zustand in `packages/ui`,
served by `apps/web`. Request engine runtime reference lives at `D:/tropel` (Tropel).
Three delivery surfaces planned: web (relay transport), browser extension (SW fetch),
desktop (Tauri + native Rust). A separate Rust relay (`apps/relay`) makes the web tier
work despite CORS. Monetization backend (auth/sync/billing) is a future phase — not started.

## 1 · Environment & commands

- Node via pnpm (`pnpm install` at root), Turbo pipelines: `pnpm build`, `pnpm dev`.
- Web dev server: `cd apps/web; npx vite dev` → http://localhost:5173 (or next free port).
- Production build check: `cd apps/web; npx vite build` (must pass before every commit).
- Rust: cargo 1.94, rustc 1.94 installed. `apps/relay` is a standalone Cargo project
  (NOT part of the pnpm workspace).
- UI styling: ONLY `packages/ui/src/styles/globals.css` with `kp-*` custom classes.
  Tailwind classes are NOT generated for packages/ui — never use them there.
- Editors/full-page views open as TABS in the main workspace, never floating dialogs.
- Verification habit: after UI changes, verify visually in browser (dev server) before commit.
- Delete stray screenshots before committing (they are gitignored for a reason).

## 2 · Repository map (current state)

```
apps/web/            Vite SPA entry (main.tsx: loadCollections → seed if empty → loadHistory)
apps/relay/          Rust/Axum CORS relay — DONE (see §4). Standalone Cargo project.
packages/core/       Domain types (Request, Response, Collection, Folder, Environment,
                     Variable, AuthConfig, BodyContent…), createId() util. Stable — extend, don't rewrite.
packages/format/     YAML byte-stable serializer, importers (cURL/Postman v2.1/HAR + auto),
                     codegen (cURL/JS fetch/Python), exporters (Postman v2.1, native JSON).
packages/transport/  Transport interface + DirectTransport + RelayTransport + getTransport().
                     Request Settings panel toggles relay vs direct.
packages/storage/    Dexie schema (collections, environments, history, workspaces) with
                     create/save/update/delete per table; OPFS BodyStore; FileSystemAdapter.
packages/engine/     Test/assertion runtime (see §5b): @tropel/shims npm package (pm/bru/
                     chai) over TS bridge host. M3 swaps the host for @tropel/runtime-wasm;
packages/ui/         ALL UI. Zustand store (store/app-store.ts) — tabs are polymorphic:
                     kind "request" | "environment" | "collection" | "runner". Variable
                     resolution in store/variables.ts ({{var}} with collection < environment
                     precedence; collection auth injected for auth.type "inherit"). Components:
                     layout/ (AppShell, Sidebar), request/RequestEditor, response/ (ResponseBody,
                     ResponseSummary), command/CommandPalette, modals/Modals (Codegen + Import),
                     runner/RunnerTab (full-area collection runner tab), collections/CollectionEditor
                     (Overview/Auth/Scripts/Tests/Variables/Runs subtabs), websocket/WebSocketModal,
                     environments/EnvironmentEditor, common/ (CodeEditor CodeMirror 6 wrapper,
                     AuthEditor + AssertionsEditor shared by request & collection editors).
packages/plugin-host, plugin-api/   Stubs only (M4).
```

## 3 · Done (M0–M2) — do not redo

- Monorepo scaffold, all packages compiling, `vite build` green.
- UI matches `default_design.png` (sidebar nav, collection tree, 2-col workspace, status bar).
- Send flow: method/URL/params/headers/auth/body editors, response pretty/raw/headers view,
  status/timing/size summary with sparkline.
- Seed collection (E-Commerce) + Dev/Prod environments on first load.
- {{var}} resolution through url/params/headers/body/auth; env selector in top bar.
- History: IndexedDB-persisted, reopenable in tabs, clearable.
- Importers (cURL, Postman v2.1, HAR, auto-detect) + import modal.
- Codegen modal (cURL/JS/Python) with regex syntax highlighting + copy.
- Collection runner (sequential, iterations, per-request pass/fail) — now a full-area
  RUNNER TAB (Postman style): config list with per-request toggles, live results,
  per-request Response/Headers/Tests detail pane, history in CollectionEditor Runs subtab.
  Runner state lives in the store (`runnerStates[collectionId]`) so it survives tab
  switches; runner executes the LIVE open-tab copy of a request (unsaved edits included);
  closing a dirty request tab flushes its edits into the collection tree + persists.
- Collection editor full-area tab: Overview (markdown), Authorization, Scripts
  (pre/test), Tests (declarative assertions), Variables, Runs. Collection-level auth
  applies to requests with auth "inherit"; collection pre/test scripts + assertions run
  in the send path and the runner, merged with the request's own.
- WebSocket client modal (connect/send/log).
- CodeMirror 6 for body + pre-request/test script editors.
- Collections: create (palette/sidebar +), rename/delete, nested folders CRUD,
  new request in collection or folder, request delete. All persisted to IndexedDB;
  environments persisted too; active environment remembered (localStorage).
- Environment editor: full-area tab (polymorphic tab kind "environment"), live edits.
- Export: Postman v2.1 JSON download via command palette.
- Escape closes any modal; Ctrl+K palette; Ctrl+W closes tab; Ctrl+Enter send; Ctrl+S save-to-collection; theme toggle (dark/light, persisted).
- Settings modal: theme, relay toggle/URL, global request timeout (all localStorage-persisted); timeout aborts in-flight sends.

## 4 · apps/relay (Rust/Axum) — DONE, plus frontend wiring

Decision (settled, see KNOCKPORT_ARCHITECTURE.md §5b/§10): Rust + **Axum** (hyper/tokio/tower
base = minimal memory; Actix adds its own runtime; raw hyper costs maintainability). It is a
**backend service, separate from the frontend** — Hoppscotch precedent: their web app proxies
through a separate self-hostable proxy service. Later it sits behind the monetization API
gateway but stays its own deployable.

Implemented & verified:
- `apps/relay` Axum service: POST /proxy (JSON request descriptor → full response with
  status/headers/body/encoding/timings), GET /health, GET /metrics (counters only).
- SSRF blocklist (loopback/private/link-local/broadcast/CGNAT/ULA + v4-mapped), DNS resolved
  per request, redirects followed manually with per-hop SSRF re-check (max 5), RFC-correct
  301/302/303 GET-downgrade.
- Caps: 10 MB req / 50 MB resp / 30 s timeout; per-IP rate limit 60 req/min; hop-by-hop
  headers stripped; CORS = any localhost port in dev, `KP_RELAY_ORIGINS` list in prod.
- Windows build: **MSVC** (VS 2022 Build Tools installed; do NOT use GNU target). Release
  binary ~5.9 MB with LTO. Run: `cargo build --release; target\release\knockport-relay.exe`.
- Frontend: `packages/transport` has `RelayTransport` + `getTransport({useRelay, relayUrl})`;
  shared buildUrl/headers/body helpers extracted from DirectTransport. Request Settings panel
  has "Send via relay" checkbox + Relay URL field (persisted in localStorage keys
  `kp-use-relay` / `kp-relay-url`, store fields `useRelay`/`relayUrl`). Runner uses same path.
- Verified E2E in browser: POST /proxy 200, response rendered, zero console errors, setting
  persists across reload.

Follow-ups (not blocking):
- [ ] Multipart bodies via relay (FormData can't be JSON-serialized — needs base64 parts wire format).
- [ ] Swap reqwest for `tropel-http` path-dep from D:/tropel (reuse its SSRF blacklist, cookie jar, subtimings).
- [ ] Session token before public deployment (architecture doc §5b checklist).
- [ ] Relay auto-health indicator in the status bar.

## 5 · After relay — UI completeness (M2 remainder)

- [x] Assertions/tests executed client-side — DONE via @tropel/shims (see §5b).
      `request.assertions` (declarative) + `scripts.test` both run; results render in the
      response Tests tab and gate the runner verdict.
- [ ] Importers — **decided: reuse Tropel input adapters, do NOT rewrite in TS** (see §5a).
      Existing TS importers (cURL/Postman/HAR) stay as the fallback until the wasm import
      slice lands; new formats (OpenAPI/Swagger/Bruno/Insomnia/.http) are implemented in
      Tropel only.
- [x] Export — DONE: command palette has four export commands (active collection,
      fallback first): Postman v2.1 (`.postman_collection.json`), native KnockPort JSON
      (`exportJson` → `.knockport.json`), collection YAML (`serializeCollection` →
      `.yaml`, text/yaml), and environment YAML (`serializeEnvironment` → `.yaml`).
      Verified in browser via Blob capture. Round-trip import of the native formats is
      DONE too: `importAuto` now detects native collection/request/environment JSON +
      YAML (ids persisted in the YAML docs and regenerated on import via
      `assignCollectionIds`, order lists remapped); ImportModal routes environments to
      the environments store. 10 vitest round-trip cases in packages/format.
- [x] Collection variables editing UI — DONE: full-area tab (Braces button on collection row),
      `pm.collectionVariables.*` + `{{var}}` resolution wired into send/runner; env overrides collection.
- [x] Virtualized sidebar tree (perf, when collections get big). DONE: `components/layout/CollectionTree.tsx`
      flattens the forest depth-first (`tree-model.ts`, pure + tested) and renders it through
      @tanstack/react-virtual (only the visible slice + 12-row overscan is mounted). Expand/
      collapse state moved to the store (`collapsedNodes` + `toggleNode`) so it survives
      sidebar-tab switching. 5 vitest cases incl. a 50 000-request forest (flatten < 500 ms).
- [x] Disk-backed collections via FileSystemAdapter (open folder → read/write YAML per §5a of the arch doc).
      DONE: `packages/format/src/files.ts` serializes/parses the multi-file directory layout
      (`knockport.yaml` + `requests/**/folder.yaml` + per-request YAML, IDs persisted in files,
      byte-stable, order preserved); 5 vitest round-trip cases. `packages/storage` gained
      `readAllYaml()` (recursive), `removeEntry()` (recursive delete) and `rootName()` on
      FileSystemAdapter. UI: palette command "Open Collection Folder…" imports the folder's
      collection and binds the handle; `store/disk.ts` auto-writes changes back to disk
      (debounced 400 ms via `installDiskSync()`, stale YAML leaves removed), "Save Collection to
      Folder" force-writes, disk-backed collections show an open-folder badge in the tree.
      Handles are session-only (re-open the folder next session).
- [x] Settings modal (theme, relay URL, timeouts) instead of inline prompts. DONE: `components/settings/SettingsModal.tsx` (opened from topbar gear + sidebar Settings nav, Escape closes); theme dark/light + relay toggle/URL + global `timeoutMs` all persisted to localStorage (`kp-theme`, `kp-use-relay`, `kp-relay-url`, `kp-timeout-ms`). Timeout is enforced in `handleSend` + RunnerTab via an AbortSignal passed through `TransportOptions.signal`; AbortError renders "Request timed out after N ms". The per-request Settings tab now points to the global modal.
- [x] Keyboard shortcuts: Ctrl+Enter send, Ctrl+S save-to-collection. DONE: global keydown in AppShell (skipped while any modal/palette is open, request tabs only); Ctrl+S uses new store action `saveRequestTab` (flushes dirty tab into owning collection + persistCollection without closing); `handleSend` in RequestEditor.tsx is exported for reuse.
- [x] Response preview tab (HTML render in sandboxed iframe), cookies tab data. DONE: Preview tab in
      ResponseBody now renders HTML in a fully sandboxed iframe (`sandbox=""`), injects `<base>`
      from the resolved request URL (`Response.url`) so relative links resolve, and shows a notice
      for non-HTML bodies. Cookies tab lists every Set-Cookie with full attributes
      (Domain/Path/Expires/Max-Age/SameSite/HttpOnly/Secure) and a tab count badge. Transport fixes:
      RelayTransport preserved multiple Set-Cookie header pairs (previously flattened into one →
      cookies lost); cookie parser no longer splits on commas (broke `Expires` dates) and splits
      attribute pairs on the first `=` only; DirectTransport uses `Headers.getSetCookie()`.
      8 vitest cases in packages/transport + a relay-live E2E guard (skips when relay offline).

## 5a · Importers — shared via Tropel input adapters (DECIDED)

One implementation for every surface (web wasm, extension, desktop native, CLI):
- Tropel (`D:/tropel/crates/inputs/*`) defines `tropel_sdk::InputAdapter`
  (`id` / `detect(bytes)` / `parse(bytes) -> Scenario`), registered via
  `inventory::submit!` with priority-based auto-detect. Linked through tropel-engine.
- Existing adapters: openapi (3.x + Swagger 2.0, $ref resolution), har, postman
  (v2.1 via tropel-collection), k6, subprocess.
- Added by us (committed in Tropel): `tropel-input-bru` (Bruno .bru block grammar,
  path params → {{vars}}, disabled `~key` dropped, scripts/tests mapped) and
  `tropel-input-insomnia` (v4 export JSON, parentId tree rebuild, env → variables).
- Still to add in Tropel, same pattern: `tropel-input-http` (.http files),
  `tropel-input-curl` (cURL one-liners).
- KnockPort consumption plan:
  1. Add an import entry point to the wasm slice (tropel-web or a slim new crate):
     `import_any(bytes) -> Scenario JSON` iterating registered adapters by priority.
  2. packages/format: one TS mapper `Scenario → Collection` (ScenarioItem folders ↔
     Folder tree, Request fields ↔ core Request, Body variants ↔ BodyContent,
     AuthConfig ↔ AuthConfig). That mapper is the ONLY KnockPort-side import code.
  3. ImportModal: file upload (File System Access / drag-drop) → wasm import_any.
     Bruno collections are directory trees → read every .bru under the folder
     (bruno.json marks the root), one adapter call per file, assemble folders from paths.
- Until the wasm slice lands, TS importers for cURL/Postman/HAR remain the web path.

## 5b · Test scripting — @tropel/shims over a TS bridge host (DONE)

Decision (user-directed): do NOT hand-roll assertions in TS and do NOT vendor copies —
consume the PUBLISHED `@tropel/shims` npm package (the same sources the tropel runtime
embeds, ShimBundle::default()) so scripts are byte-compatible with the M3 wasm runtime.

- Dependency: `@tropel/shims@0.1.0` in packages/engine. API: `defaultBundle` /
  `k6Bundle` (arrays of `{name, source}`) + `render(entries?)`. test-runner.ts subsets
  defaultBundle to pm-shim/chai-shim/bru-shim (filter keeps the canonical engine order
  pm → chai → … → bru); lodash/cryptojs/exec need bridges KnockPort doesn't host yet.
- `packages/engine/src/test-runner.ts` is the HOST: `buildBridges()` implements the
  `__tropel_pm_*` bridges in TS (response code/status/time/headers/body/json/cookies,
  env/variables/collectionVariables stores, pm.test recording). A realm factory compiles
  `render(subset) + prelude` ONCE via `new Function`; every run gets a fresh sandbox
  (shims install non-configurable globalThis bindings) and direct-evals the user script
  in prelude scope. `__tropel_sandbox_config = {namespace: 'kp'}` → canonical namespace
  is `kp.*`; `pm.*` and `bru.*` are compat peers.
- KNOWN GAP: published 0.1.0 is STALE vs D:\tropel\js (cut before the chai
  above/below/oneOf additions and the pm.js AssertChain rewrite). Tests + the TestsPanel
  hint are written against the 0.1.0 MINIMUM surface (eql/include/equal/property,
  head-of-chain `.not`, res.getStatus() = status TEXT) so they stay green when 0.1.1
  ships. Local rebuild of D:\tropel\packages\shims (shim/ + dist/) is done and smoke
  PASSES — publishing 0.1.1 needs `npm login` (this session was 401). After publish:
  bump the dep and restore the richer assertions (above/oneOf) in tests.
- Semantics to remember: `pm.response.code` is the NUMERIC status, `pm.response.status`
  is the reason TEXT; `pm.expect` is a lightweight chain, full chai lives at global
  `chai.expect`; `pm.test` records one check, thrown errors become `<name> (error)`
  failed checks; variable stores JSON-encode on set / parse on get. `pm.request.headers`
  is a Postman-style HeaderList (`.get()` / `.add()` / `.upsert()` / `.all()` /
  `.toObject()`), NOT a plain object — bracket access returns undefined and throws
  inside kp.expect.
- Security: this host is NOT a sandbox — it executes user-authored scripts in the user's
  own browser (documented in test-runner.ts). Real isolation arrives in M3 (QuickJS wasm).
- M3 swap path: replace `createRealmWithHost` with wasm realm; bridges become Rust
  functions; shim sources unchanged. Assertions data is passed as a JSON literal, never
  string-concatenated into the script.
- Tests: `packages/engine/src/test-runner.test.ts` — 13 vitest cases (kp/pm/bru surfaces,
  declarative assertions, error paths, runPreScript). Run: `cd packages/engine; npx vitest run`.

## 6 · M3 · Scripting engine

- [ ] `packages/engine`: @tropel/runtime-wasm in a Web Worker, postcard ABI (see D:/tropel).
      Replace the TS bridge host in test-runner.ts; keep the @tropel/shims sources.
- [ ] Lazy-load wasm after first paint.
- [x] Script editor type hints (CodeMirror completions) for kp.*/pm.*/bru.*. DONE:
      `packages/ui/src/components/common/script-completions.ts` provides an
      @codemirror/autocomplete override that offers members after `kp.` / `pm.` / `bru.`
      and nested members after `kp.response.` etc., with signatures + info text. Wired into
      every JavaScript CodeMirror editor via `languageExtension`. 5 vitest cases.
- [x] Full JS editor intelligence: syntax linting + generic JS completions. DONE:
      `script-lint.ts` — @codemirror/lint source over lezer "⚠" error nodes with
      bracket/string-context message inference ("Expecting ')' here.", "Unterminated
      string — …"); `script-snippets.ts` — keywords, browser globals (console/JSON/Math…),
      and snippets (console.log, kp.test, response.json) offered outside API chains,
      {{var}} placeholders skipped; both wired into `languageExtension`. 9 vitest cases
      in script-editor.test.ts. Deps added to packages/ui: @codemirror/language,
      @codemirror/lint.

## 7 · M4 · Plugin host

- [ ] Worker sandbox + capability broker (plugin-host), public SDK (plugin-api, npm-publishable).
- [ ] Port importers/exporters onto the plugin API; manifest + install/enable UI.

## 8 · M5–M10 (see architecture doc §9 for detail)

- M5 Runner++: setNextRequest, data files (CSV/JSON), diff view, snapshots, `kp` CLI.
- M6 Extension (WXT): SW transport, DNR forbidden-header rewrite spike, traffic capture.
- M7 Desktop (Tauri 2): native tropel-runtime, localhost/mTLS/client certs.
- M8 Protocols: SSE, Socket.IO, MQTT, GraphQL subscriptions, gRPC.
- M9 Load testing: load block editor → native agent/cloud runner (never in-browser percentiles).
- M10 Collaboration: git-native diff/PR flow, optional sync.

## 9 · Monetization backend (future phase — not started)

Separate from the relay. Expected shape (decide when we get there):
- Auth (accounts, API keys), collection sync (thin layer over the YAML file format,
  never a replacement), workspaces/teams, billing.
- Relay stays its own service behind the same gateway; add session tokens + per-plan
  rate limits there (abuse-prevention checklist in architecture doc §5b is non-negotiable
  before the relay is public: SSRF blocking, rate limits, size caps, session token,
  zero request logging, published privacy stance).

## 10 · Conventions & gotchas

- Git: small commits, conventional-ish messages, NEVER mention AI/agent in commits.
- Don't commit screenshots (gitignored). Clean workspace root before `git add -A`.
- packages/ui has NO Tailwind — kp-* classes in globals.css only.
- Zustand selectors individually (avoid whole-store subscriptions → re-render storms).
- Dexie `save()` = upsert (put); `update()` silently no-ops on missing rows.
- PowerShell: no `&&`, use `;`. Long-lived servers run background.
- LSP sometimes reports stale "Cannot find module" for fresh files — trust `vite build`.
- Regex tokenizers with `exec` loops need zero-width match guards (`re.lastIndex++`) —
  a `(\\?$)`-style alternative once froze the app (infinite loop).
- CodeMirror 6 editors: browser-use `fill` on the `.cm-content` textbox role works;
  `execCommand('delete')` clears the DOM but does NOT commit to editor state — re-fill
  with "" instead.
- Relay SSRF guard blocks loopback/private by design — verify requests against public
  APIs (e.g. jsonplaceholder.typicode.com), never against the local dev server.

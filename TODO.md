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
apps/relay/          NOT YET CREATED — Rust/Axum CORS relay (next task, see §4)
packages/core/       Domain types (Request, Response, Collection, Folder, Environment,
                     Variable, AuthConfig, BodyContent…), createId() util. Stable — extend, don't rewrite.
packages/format/     YAML byte-stable serializer, importers (cURL/Postman v2.1/HAR + auto),
                     codegen (cURL/JS fetch/Python), exporters (Postman v2.1, native JSON).
packages/transport/  Transport interface + DirectTransport (browser fetch) + registry.
                     RelayTransport NOT implemented yet (pairs with apps/relay).
packages/storage/    Dexie schema (collections, environments, history, workspaces) with
                     create/save/update/delete per table; OPFS BodyStore; FileSystemAdapter.
packages/engine/     ScriptEngine stub (real runtime lands in M3 via @tropel/runtime-wasm).
packages/ui/         ALL UI. Zustand store (store/app-store.ts) — tabs are polymorphic:
                     kind "request" | "environment". Variable resolution in store/variables.ts
                     ({{var}} with collection < environment precedence). Components:
                     layout/ (AppShell, Sidebar), request/RequestEditor, response/ (ResponseBody,
                     ResponseSummary), command/CommandPalette, modals/Modals (Codegen + Import),
                     runner/RunnerModal, websocket/WebSocketModal, environments/EnvironmentEditor,
                     common/CodeEditor (CodeMirror 6 wrapper).
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
- Collection runner (sequential, iterations, per-request pass/fail).
- WebSocket client modal (connect/send/log).
- CodeMirror 6 for body + pre-request/test script editors.
- Collections: create (palette/sidebar +), rename/delete, nested folders CRUD,
  new request in collection or folder, request delete. All persisted to IndexedDB;
  environments persisted too; active environment remembered (localStorage).
- Environment editor: full-area tab (polymorphic tab kind "environment"), live edits.
- Export: Postman v2.1 JSON download via command palette.
- Escape closes any modal; Ctrl+K palette; Ctrl+W closes tab; theme toggle (dark/light).

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

- [ ] Assertions/tests actually executed client-side (simple expr eval first; real engine in M3)
      — runner currently reports pass/fail from HTTP status only; wire `request.assertions`.
- [ ] OpenAPI 3.x + Swagger 2.0 importer (format/importers.ts pattern), then Bruno `.bru`,
      Insomnia, `.http` importers.
- [ ] Export: native KnockPort JSON + YAML (serializeCollection already exists) from palette;
      export environment too.
- [ ] Collection variables editing UI (mirror EnvironmentEditor as full-area tab on collection).
- [ ] Virtualized sidebar tree (perf, when collections get big).
- [ ] Disk-backed collections via FileSystemAdapter (open folder → read/write YAML per §5a).
- [ ] Settings modal (theme, relay URL, timeouts) instead of inline prompts.
- [ ] Keyboard shortcuts: Ctrl+Enter send, Ctrl+S save-to-collection.
- [ ] Response preview tab (HTML render in sandboxed iframe), cookies tab data.

## 6 · M3 · Scripting engine

- [ ] `packages/engine`: @tropel/runtime-wasm in a Web Worker, postcard ABI (see D:/tropel).
- [ ] Lazy-load wasm after first paint.
- [ ] kp.* API; pm.*/bru.* compat; script editor type hints (CodeMirror completions).
- [ ] Execute pre-request scripts before send, test scripts after response; expose kp.env get/set.

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

# KnockPort — Build Progress

## M0 · Foundations

- [x] Scaffold monorepo — pnpm + Turborepo, Biome, TypeScript
- [x] `packages/core` — domain model, TS types (Request, Response, Collection, Auth, Variables, Plugins)
- [x] `packages/format` — YAML serializer with byte-stability rules (stable key order, LF, no trailing whitespace)
- [x] `packages/transport` — Transport interface + DirectTransport (browser fetch) + TransportRegistry
- [x] `packages/storage` — Dexie schema (collections, environments, history) + OPFS body store + File System Access adapter
- [x] `packages/engine` — ScriptEngine stub (interface for @tropel/runtime-wasm, lands in M3)
- [x] `.gitignore` — covers node_modules, dist, .turbo, Rust targets, WASM, env files

## M1 · Send

- [x] `packages/ui` — Zustand store (tabs, requests, responses, collections, environments, history)
- [x] Theme system — CSS variables, dark/light themes, purple accents, HTTP method colors, status code colors
- [x] UI primitives — Button, Input, Badge, Tabs, IconButton, EmptyState
- [x] Sidebar — workspace header, search, nav tabs (Collections/Environments/History), collection tree, env list, history list
- [x] Request editor — method selector, URL bar, Send button, tabs (Params/Headers/Auth/Body/Scripts/Tests/Settings)
- [x] Response viewer — status bar (status/timing/size), tabs (Pretty/Raw/Headers/Cookies/Timings), JSON pretty-print
- [x] AppShell - main layout with tab bar, sidebar toggle, request + response split
- [x] Command palette - keyboard-navigable (arrows + enter), Ctrl+K shortcut
- [x] `apps/web` - Vite SPA wired to all packages, dev server running on :5173
- [x] History persistence - Dexie-backed history with add/clear
- [x] Install deps + verify build (173 packages, pnpm + Turborepo)
- [x] Git init + initial commit (57 files, 9067 insertions, no AI attribution)

## M2 · Collections, Import/Export, Run

- [x] UI redesign to match reference layout (sidebar logo/nav/tree, tab bar, 2-col request+response)
- [x] Seed data — sample E-Commerce collection + Dev/Prod environments on first load
- [x] Variable resolution — `{{var}}` with collection < environment precedence, applied to url/params/headers/body/auth
- [x] Environments UI — selector in top bar, list in sidebar, active highlighting
- [x] Importers — cURL, Postman v2.1, HAR (+ auto-detect) with import modal
- [x] Codegen — cURL / JavaScript fetch / Python requests with codegen modal + copy
- [x] Collection runner — sequential run with iterations, per-request pass/fail + timing
- [x] WebSocket client — connect/send/message log modal
- [x] History persistence — IndexedDB-backed, entries reopenable in tabs
- [x] CodeMirror 6 — JSON/JS editors for body + pre-request/test scripts
- [x] Collection management — create (palette/sidebar), rename + delete (tree hover actions)
- [x] Folder support — nested folders with create/rename/delete + new request in folder/collection
- [x] Persistence — collections/environments saved to IndexedDB, restored on load (active env remembered)
- [x] Codegen modal — syntax highlighting for cURL/JavaScript/Python output

## Not Started

- [ ] `apps/relay` — transport-relay service (Rust/Axum)
- [ ] `apps/extension` — WXT browser extension
- [ ] `apps/desktop` — Tauri 2 shell
- [ ] `packages/plugin-host` — Worker sandbox + capability broker
- [ ] `packages/plugin-api` — published plugin SDK
- [ ] Scripting engine — real @tropel/runtime-wasm integration (M3)
- [ ] TanStack Virtual for collection tree
- [ ] SSE, Socket.IO, MQTT support
- [ ] gRPC support
- [ ] Load testing UI
- [ ] Diff view (CodeMirror merge)
- [ ] Response snapshots
- [ ] `kp` CLI

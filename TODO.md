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

## Not Started

- [ ] `apps/relay` — transport-relay service (Rust/Axum)
- [ ] `apps/extension` — WXT browser extension
- [ ] `apps/desktop` — Tauri 2 shell
- [ ] `packages/plugin-host` — Worker sandbox + capability broker
- [ ] `packages/plugin-api` — published plugin SDK
- [ ] Importers as plugins (Postman, OpenAPI, cURL, HAR, Bruno)
- [ ] CodeMirror 6 integration for request/response editors
- [ ] TanStack Virtual for collection tree
- [ ] WebSocket, SSE, Socket.IO, MQTT support
- [ ] gRPC support
- [ ] Collection runner
- [ ] Load testing UI
- [ ] Diff view (CodeMirror merge)
- [ ] Response snapshots
- [ ] `kp` CLI

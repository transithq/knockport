# KnockPort — Session Context Dump (handoff)

> Handoff file for the next agent. Read this + `TODO.md` + `KNOCKPORT_ARCHITECTURE.md` first.
> TODO.md stays canonical; this file may be deleted after use.
> Process: no AI/agent attribution in commits; `git add -u` + explicit paths (never `-A`);
> gate every commit with `pnpm --filter web build` (tsc && vite build).

## Latest session — 2026-08-16 ? 17: relay reqwest ? tropel-http swap — DONE

- Commit `add7069` — feat(relay): apps/relay now runs through `tropel-http`
  (path dep `D:/tropel/crates/tropel-http`). Proxy handler builds an
  `SdkRequest` ? `HttpClient::execute`; tropel owns redirects (RFC 7231
  rewrites), per-hop `blacklistIPs` SSRF (IP literals pre-connect + DNS
  resolver), streamed 50 MB body cap (`max_response_bytes`), and real
  connection sub-timings. Kept a thin initial-URL pre-check (403 clean shape,
  exact parity) + `dns_ttl: "0s"` (per-request re-resolve like old relay).
  Wire gains `dns`/`tcp`/`tls`/`download` timings; lossless `raw_headers`
  (duplicate Set-Cookie lines survive — frontend depends on this).
  E2E verified: GET/POST/multipart/cookies, loopback+private+nip.io+IPv6+
  v4-mapped all 403, redirect chains, hop-level SSRF 403.
- Commit `c0bd938` — TODO.md follow-up ticked.
- Tropel side (D:\tropel, branch `fix/w2-path-var-length-sort`):
  - Committed `e9f0343`: `SSRF_BLOCKLIST` const (dns.rs) +
    `HttpConfig.max_response_bytes` (config.rs). 60 tropel-http tests pass.
  - LEFT UNCOMMITTED on purpose: client.rs (`http_request_error` cause-chain
    helper + `raw_headers` field + body-cap streaming — the relay's committed
    code NEEDS these at runtime) is entangled with the concurrent W2 #203
    `Request.headers: Vec<(String,String)>` migration (sdk submodule diff,
    `trp.rs` currently breaks workspace build). Committing client.rs alone
    would produce a file that doesn't compile without the W2 sdk change —
    commit it TOGETHER with the W2 session once trp.rs/sandbox land.
- D: disk got full mid-session (cargo LNK errors); freed 8.7 GB by cargo
  clean in both D:\tropel and apps/relay. Watch disk on long builds.

## Prior session — sidebar nav/contents resize — committed

User wanted the sidebar's NAV MENU (Collections/Environments/APIs/…) and the CONTENTS box
below it to be resizable against each other vertically (the sidebar width was already
draggable since `8169c43`).

- Commit `cd6554f` — fix(ui): 8 pre-existing tsc errors at HEAD that broke the build gate
  (ApiTab `as const` request literal vs `HttpMethod`, RequestEditor form encoding + GraphQL
  variables typings, ResponseSummary optional url, store `activeResponsePanel` `"pretty"` ?
  `"body"`). Fixed minimally; 50 ui tests + build green.
- Commit `45fe479` — feat(ui): nav pane wrapped in `.kp-nav-pane` with a horizontal
  `.kp-resize-handle` (drag = fixed height, double-click = reset to auto/hug). Store:
  `navHeight` + `setNavHeight` (localStorage `kp-nav-height`; 0 = auto). Sidebar gains
  `asideRef`/`navPaneRef`; `useResizer("y")`; min 96px, max = sidebar height ? 240 reserved.
  CSS: `.kp-sidebar > .kp-resize-handle.horizontal` overrides the absolute-position rule
  meant for the vertical (width) handle.
- Commit `781ceb5` — fix(ui): `.kp-sidebar-section` border-top + margin-top removed — the
  contents box's own border was stacking under the handle hairline; the handle is now the
  single divider. (User flagged "divider and border seen two separately, looks awful".)

## Recent history (compressed — details in git log)

- **Relay hardening + protocols** (commits up to `487d4f0`): KP_RELAY_TOKEN auth, multipart
  via base64 parts, mock servers, relay health indicator; GraphQL body + SOAP helper; SSE,
  MQTT, WebSocket, APIs, Mock Servers full-area workspace tabs; URL bar ? params sync;
  Tab-completion; Settings full-area tab; response viewer = read-only CodeMirror 6 with
  content-type detection + preview iframe (sandboxed, `<base>` injected) + cookies tab
  with full attributes. gRPC still deferred (relay-side protox plan).
- **MQTT fix** `487d4f0`: node builtins polyfilled (`node-url-shim.ts`, `polyfills.ts`) for
  mqtt.js v4 in the browser.
- Scripting: kp/pm/bru completions, syntax linting, generic JS completions, post-response
  script phase (Bruno ordering: pre ? send ? post ? tests; vars carry across runner requests).
- Disk-backed collections (FileSystemAdapter + YAML multi-file layout, debounced sync).
- Virtualized sidebar tree (@tanstack/react-virtual, `tree-model.ts`).
- Export/import: Postman + native JSON/YAML collections & envs, round-trip in `importAuto`.

## Rules & gotchas (do not re-learn)

**Project rules**
- Commits: NEVER mention AI/agent. Use `git add -u` + explicit new paths; never `git add -A`.
- PowerShell: `;` not `&&`. Long-lived servers run in background.
- packages/ui: NO Tailwind — only `kp-*` classes in `packages/ui/src/styles/globals.css`.
- Editors/full-page views open as full-area TABS, never modals.
- Build gate before every commit: `pnpm --filter web build`.
- User's standing instruction: "dont stop anywhere keep on running".
- Verify request execution against public APIs (jsonplaceholder.typicode.com); the relay
  blocks loopback by design (SSRF guard in `apps/relay/src/main.rs`).
- DO NOT use browser-use tool for verification (token budget). Append manual QA items to
  `MANUAL_TEST_CHECKLIST.md` (repo root, UNTRACKED — never commit it).

**Env state**
- Vite dev server is usually running on localhost (last known: :5175); IndexedDB db `knockport`.
- Relay: `kp-use-relay`/`kp-relay-url` in localStorage; `http://localhost:8787` default.
- `.staging/` holds shallow clones (bruno, hoppscotch, tropel adapters) — gitignored;
  use `git -C <clone> grep`, not ripgrep.

**Code facts**
- Pane sizing patterns live in `useResizer` (Bruno-style: anchor on mousedown, clamp live).
- `resolveRequest` (store/variables.ts) injects collection auth for `auth.type === "inherit"`.
- `test-runner.ts`: `runTests`/`runPostResponseScript` never throw; `host.request` = resolved
  request with injected headers; `pm.request.headers` is a HeaderList (`.get()`, not brackets).
- Dexie `save()` = upsert; `update()` no-ops on missing rows.
- @tropel/shims 0.1.0 (published) is stale vs D:/tropel — 0.1.1 prepared but npm login 401'd.

## Next actions for the receiving agent

1. Continue TODO.md §5/§6: Tropel input adapters wasm slice (big), @tropel/runtime-wasm (M3).
2. Optional: History full-area tab (recommended), round-trip import polish.
3. MANUAL_TEST_CHECKLIST.md may hold untested items from prior sessions.

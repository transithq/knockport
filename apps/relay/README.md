# KnockPort Relay

Server-side CORS relay for the web tier. The browser POSTs request descriptors
to `/proxy`; the relay executes them server-side and returns the full response.
API-client traffic only — never load testing (see `KNOCKPORT_ARCHITECTURE.md` §5b).

## Stack

Rust · Axum · tokio · reqwest (rustls). Chosen for minimal memory (hyper/tokio
base) and tower middleware. Requires MSVC Build Tools on Windows (link.exe).

## Run

```powershell
cd apps/relay
cargo run --release            # or: target\release\knockport-relay.exe
```

Environment:

| Var               | Default                                | Purpose                          |
|-------------------|----------------------------------------|----------------------------------|
| `PORT`            | `8787`                                 | bind port                        |
| `KP_RELAY_ORIGINS`| localhost:5173/5174 (+127.0.0.1 same)  | comma-separated allowed origins  |
| `RUST_LOG`        | `info`                                 | tracing filter                   |

## Endpoints

- `GET /health` → `{ "ok": true, "service": "knockport-relay" }`
- `GET /metrics` → counters only (requests, failures, bytes in/out, total_ms). **No URLs/headers/bodies ever.**
- `POST /proxy` — body `{ method, url, headers: [{key,value}], body? }` →
  `{ status, statusText, headers, body, encoding ("utf8"|"base64"), timings { total, ttfb } }`

## Built-in protections (must stay enabled before public deployment)

- SSRF blocklist: loopback / private / link-local / broadcast / CGNAT / ULA,
  resolved per hop — redirects are followed manually and every hop re-checked
- Scheme allowlist: http/https only
- Caps: 10 MB request body, 50 MB response body, 5 redirects, 30 s timeout
- Rate limit: 60 req/min per IP (fixed window, in-memory)
- Hop-by-hop headers stripped in both directions

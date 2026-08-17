//! KnockPort CORS relay.
//!
//! Forwards browser API requests server-side so the web tier isn't blocked by
//! CORS. Scope is API-client traffic only — never load testing (see
//! KNOCKPORT_ARCHITECTURE.md §5b).
//!
//! Request execution is delegated to `tropel-http` (path dep from D:/tropel):
//! it owns redirects (RFC 7231 method rewrites), the SSRF `blacklistIPs`
//! enforcement on every hop (IP literals AND DNS-resolved addresses), the
//! response-byte cap, and per-hop connection sub-timings.
//!
//! Privacy: metrics only. URLs, headers and bodies are never logged.

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    routing::{any, delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tracing::info;
use tropel_http::{parse_blacklist, HttpClient, HttpConfig, IpCidr, SSRF_BLOCKLIST};
use tropel_sdk::types::{Body as SdkBody, Method as SdkMethod, Request as SdkRequest};

// ── Caps (architecture doc §5b) ──────────────────────────────────────────────
const MAX_REQUEST_BODY: usize = 10 * 1024 * 1024; // 10 MB
const MAX_RESPONSE_BODY: usize = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS: u32 = 5;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RATE_WINDOW_SECS: u64 = 60;
const RATE_MAX_PER_WINDOW: u32 = 60;

// Hop-by-hop headers never forwarded in either direction.
const HOP_HEADERS: [&str; 8] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

#[derive(Deserialize, Serialize, Clone)]
struct HeaderPair {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct ProxyRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<HeaderPair>,
    #[serde(default)]
    body: Option<String>,
    /// Multipart/form-data parts (files base64). When present the relay builds
    /// the body and owns the boundary + content-type.
    #[serde(default)]
    multipart: Vec<MultipartPart>,
}

#[derive(Deserialize)]
struct MultipartPart {
    name: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    content_type: Option<String>,
    #[serde(default)]
    data_base64: Option<String>,
}

// ── Mock servers ──────────────────────────────────────────────────────────────
#[derive(Deserialize, Clone)]
struct MockRoute {
    method: String,
    /// Path pattern: literal segments, `:param` (one segment), `*` (rest).
    path: String,
    status: u16,
    #[serde(default)]
    body: String,
    #[serde(default)]
    content_type: String,
    #[serde(default)]
    headers: Vec<HeaderPair>,
    #[serde(default)]
    delay_ms: u64,
}

#[derive(Deserialize)]
struct MockRegister {
    id: String,
    #[serde(default)]
    routes: Vec<MockRoute>,
}

const MAX_MOCK_ROUTES: usize = 200;

#[derive(Serialize)]
struct Timings {
    total: f64,
    ttfb: f64,
    download: f64,
    dns: f64,
    /// TCP connect time (TLS included on https — reqwest folds the handshake
    /// into the connector call, so `tls` stays 0 when `tcp` is measured).
    tcp: f64,
    tls: f64,
}

#[derive(Serialize)]
struct ProxyResponse {
    status: u16,
    status_text: String,
    headers: Vec<HeaderPair>,
    body: String,
    /// "utf8" when the body decoded cleanly, otherwise "base64".
    encoding: &'static str,
    timings: Timings,
}

#[derive(Default)]
struct Metrics {
    requests: AtomicU64,
    failures: AtomicU64,
    bytes_in: AtomicU64,
    bytes_out: AtomicU64,
    total_ms: AtomicU64,
}

struct AppState {
    client: HttpClient,
    /// Parsed `SSRF_BLOCKLIST` CIDRs for the initial-URL pre-check (the
    /// per-hop enforcement itself lives inside tropel-http's DNS resolver
    /// and IP-literal guard, fed the same list via `blacklist_ips`).
    blocklist: Vec<IpCidr>,
    metrics: Metrics,
    /// Fixed-window per-IP rate limiter: ip -> (window_start_unix, count).
    rate: Mutex<HashMap<IpAddr, (u64, u32)>>,
    /// Session token (KP_RELAY_TOKEN). When set, /proxy and /metrics require
    /// `Authorization: Bearer <token>`; /health stays public for status checks.
    token: Option<String>,
    /// Registered mock servers: id -> routes. In-memory only — clients
    /// re-register on start (definitions live client-side).
    mocks: Mutex<HashMap<String, Vec<MockRoute>>>,
}

/// Constant-time-ish comparison so token checks don't leak length/prefix timing.
fn token_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn check_token(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let Some(expected) = &state.token else {
        return Ok(());
    };
    let got = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match got {
        Some(g) if token_eq(g, expected) => Ok(()),
        _ => Err(err(StatusCode::UNAUTHORIZED, "missing or invalid relay token")),
    }
}

/// Fast SSRF pre-check for the INITIAL URL so blocked targets fail with a
/// clean 403 instead of a generic 502 from the reqwest error chain. This is
/// error-mapping, not the enforcement layer — `tropel-http` re-checks the
/// blacklist on EVERY hop (IP literals before connect, DNS answers in its
/// resolver), covering redirects this single check can't see. Rejects a host
/// as soon as ANY resolved address falls inside the blocklist (defeats
/// mixed-answer DNS rebinding, same semantics as the original relay).
async fn ssrf_precheck(url: &url::Url, blocklist: &[IpCidr]) -> Result<(), &'static str> {
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("scheme not allowed"),
    }
    let host = url.host_str().ok_or("missing host")?;
    let port = url.port_or_known_default().ok_or("missing port")?;

    // Literal IP hosts are checked directly (strip url-crate v6 brackets).
    let stripped = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = stripped.parse::<IpAddr>() {
        return if blocklist.iter().any(|c| c.contains(ip)) {
            Err("target address is blocked")
        } else {
            Ok(())
        };
    }

    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.to_string(), port))
        .await
        .map_err(|_| "dns resolution failed")?
        .collect();
    if addrs.is_empty() {
        return Err("dns resolution returned no addresses");
    }
    for addr in &addrs {
        if blocklist.iter().any(|c| c.contains(addr.ip())) {
            return Err("target address is blocked");
        }
    }
    Ok(())
}

// ── Rate limiting (fixed window per IP) ─────────────────────────────────────
fn rate_limited(state: &AppState, ip: IpAddr) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut map = state.rate.lock().unwrap();
    let entry = map.entry(ip).or_insert((now, 0));
    if now - entry.0 >= RATE_WINDOW_SECS {
        *entry = (now, 0);
    }
    entry.1 += 1;
    entry.1 > RATE_MAX_PER_WINDOW
}

fn err(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": message })))
}

/// Minimal base64 decoder (standard alphabet, padding optional).
fn base64_decode(s: &str) -> Result<Vec<u8>, ()> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for b in s.bytes().filter(|b| !b" \t\r\n".contains(b)) {
        if b == b'=' {
            break;
        }
        buf = (buf << 6) | val(b).ok_or(())? as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

fn escape_quoted(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Assemble a multipart/form-data body from wire parts. Returns the body bytes
/// plus the boundary so the caller can set the matching content-type header.
fn build_multipart(
    parts: &[MultipartPart],
) -> Result<(Vec<u8>, String), (StatusCode, Json<serde_json::Value>)> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let boundary = format!(
        "knockport-{:x}-{:x}-{:x}",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let mut body: Vec<u8> = Vec::new();
    for part in parts {
        let data: Vec<u8> = if let Some(b64) = &part.data_base64 {
            base64_decode(b64)
                .map_err(|_| err(StatusCode::BAD_REQUEST, "invalid base64 in multipart part"))?
        } else if let Some(v) = &part.value {
            v.clone().into_bytes()
        } else {
            Vec::new()
        };
        if body.len() + data.len() > MAX_REQUEST_BODY {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "request body too large"));
        }

        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        let mut cd = format!("form-data; name=\"{}\"", escape_quoted(&part.name));
        if let Some(fname) = &part.filename {
            cd.push_str(&format!("; filename=\"{}\"", escape_quoted(fname)));
        }
        body.extend_from_slice(format!("content-disposition: {cd}\r\n").as_bytes());
        if let Some(ct) = &part.content_type {
            body.extend_from_slice(format!("content-type: {ct}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(&data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((body, boundary))
}

// ── Handlers ─────────────────────────────────────────────────────────────────
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "service": "knockport-relay" }))
}

async fn metrics(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_token(&state, &headers)?;
    let m = &state.metrics;
    Ok(Json(serde_json::json!({
        "requests": m.requests.load(Ordering::Relaxed),
        "failures": m.failures.load(Ordering::Relaxed),
        "bytes_in": m.bytes_in.load(Ordering::Relaxed),
        "bytes_out": m.bytes_out.load(Ordering::Relaxed),
        "total_ms_sum": m.total_ms.load(Ordering::Relaxed),
    })))
}

async fn proxy(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<ProxyRequest>,
) -> Result<Json<ProxyResponse>, (StatusCode, Json<serde_json::Value>)> {
    check_token(&state, &headers)?;
    let ip = addr.ip();
    if rate_limited(&state, ip) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded"));
    }

    let url = url::Url::parse(&payload.url).map_err(|_| err(StatusCode::BAD_REQUEST, "invalid url"))?;
    // Fast 403 path for blocked initial targets (clean error shape); hop-by-hop
    // enforcement stays inside tropel-http (see build-time HttpConfig).
    ssrf_precheck(&url, &state.blocklist)
        .await
        .map_err(|reason| err(StatusCode::FORBIDDEN, reason))?;

    let (body_bytes, multipart_ct): (Vec<u8>, Option<String>) = if payload.multipart.is_empty() {
        (
            match &payload.body {
                Some(b) if b.len() > MAX_REQUEST_BODY => {
                    return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "request body too large"))
                }
                Some(b) => b.as_bytes().to_vec(),
                None => Vec::new(),
            },
            None,
        )
    } else {
        let (bytes, boundary) = build_multipart(&payload.multipart)?;
        (
            bytes,
            Some(format!("multipart/form-data; boundary={boundary}")),
        )
    };

    let method = SdkMethod::parse(&payload.method)
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid method"))?;

    // Never forward hop-by-hop, host, or content-length request headers.
    // Order and duplicate names are preserved end-to-end (e.g. several
    // Cookie lines) — tropel-sdk's Request.headers is an ordered pair list.
    let mut headers: Vec<(String, String)> = Vec::new();
    for pair in &payload.headers {
        let name = pair.key.to_ascii_lowercase();
        if name == "host" || name == "content-length" || HOP_HEADERS.contains(&name.as_str()) {
            continue;
        }
        // The relay owns the content-type when it assembles a multipart body.
        if multipart_ct.is_some() && name == "content-type" {
            continue;
        }
        headers.push((pair.key.clone(), pair.value.clone()));
    }
    if let Some(ct) = &multipart_ct {
        headers.push(("Content-Type".to_string(), ct.clone()));
    }

    let started = Instant::now();
    state.metrics.requests.fetch_add(1, Ordering::Relaxed);
    state.metrics.bytes_in.fetch_add(body_bytes.len() as u64, Ordering::Relaxed);

    // GET/HEAD carry no body (browser fetch semantics — DirectTransport and
    // the pre-tropel relay both dropped bodies for these methods; the
    // frontend never sends one either, so this is defense in depth).
    let body = if body_bytes.is_empty() || matches!(method, SdkMethod::GET | SdkMethod::HEAD) {
        None
    } else {
        Some(SdkBody::Binary(body_bytes))
    };

    let request = SdkRequest {
        url: url.to_string(),
        method,
        headers,
        body,
        timeout: Some(REQUEST_TIMEOUT),
        ..Default::default()
    };

    // tropel-http owns the hard parts: redirect following with RFC 7231 method
    // rewrites, per-hop SSRF `blacklistIPs` enforcement (IP literals and DNS
    // resolvers alike), the response-byte cap, and connection sub-timings.
    let response = match state.client.execute(&request, None).await {
        Ok(resp) => resp,
        Err(e) => {
            state.metrics.failures.fetch_add(1, Ordering::Relaxed);
            let msg = e.to_string();
            // "blacklist" = hop-level blocklist literal; "blacklisted" = the
            // DNS resolver's "all resolved addresses ... are blacklisted"
            // (redirect hops — the initial URL is pre-checked to a 403 above,
            // so a blocklist hit here is always a blocked redirect target).
            if msg.contains("blacklist") {
                return Err(err(StatusCode::FORBIDDEN, "target address is blocked"));
            }
            if msg.contains("byte limit") {
                return Err(err(StatusCode::BAD_GATEWAY, "response body too large"));
            }
            return Err(err(StatusCode::BAD_GATEWAY, "upstream request failed"));
        }
    };

    // Lossless header list (duplicate names preserved, e.g. multiple
    // Set-Cookie lines) minus hop-by-hop / content-coding headers.
    let response_headers: Vec<HeaderPair> = response
        .raw_headers
        .iter()
        .filter(|(name, _)| {
            let n = name.to_ascii_lowercase();
            !HOP_HEADERS.contains(&n.as_str()) && n != "content-encoding" && n != "content-length"
        })
        .map(|(name, value)| HeaderPair {
            key: name.clone(),
            value: value.clone(),
        })
        .collect();

    let body = &response.body;
    let total = started.elapsed().as_secs_f64() * 1000.0;
    state.metrics.bytes_out.fetch_add(body.len() as u64, Ordering::Relaxed);
    state.metrics.total_ms.fetch_add(total as u64, Ordering::Relaxed);

    let (body_text, encoding) = match String::from_utf8(body.clone()) {
        Ok(text) => (text, "utf8"),
        Err(_) => (base64_encode(body), "base64"),
    };

    // Match the old wire shape: no reason phrase → empty string (tropel-http
    // reports "Unknown" where reqwest's canonical_reason() returned None).
    let status_text = if response.status_text == "Unknown" {
        String::new()
    } else {
        response.status_text.clone()
    };
    let timings = wire_timings(&response, total);

    Ok(Json(ProxyResponse {
        status: response.status_code,
        status_text,
        headers: response_headers,
        body: body_text,
        encoding,
        timings,
    }))
}

/// Map tropel-http's per-hop sub-timings onto the relay wire format.
///
/// `total` is the whole wall clock the caller saw (all hops included);
/// `ttfb` covers the FIRST hop from start until its response head arrived
/// (blocked + dns + connecting + waiting); `dns` / `tcp` are that hop's
/// connection phases (reqwest folds the TLS handshake into `connecting`, so
/// `tls` stays 0 while `tcp` carries it); `download` is the FINAL response's
/// body-receiving time.
fn wire_timings(response: &tropel_http::HttpResponse, total_ms: f64) -> Timings {
    let ms = |d: Duration| d.as_secs_f64() * 1000.0;
    let fallback = Timings {
        total: total_ms,
        ttfb: total_ms,
        download: 0.0,
        dns: 0.0,
        tcp: 0.0,
        tls: 0.0,
    };
    // No redirects → the final response IS the first (only) hop.
    let first = if response.redirects.is_empty() {
        response.timings.as_ref()
    } else {
        response.redirects.first().and_then(|h| h.timings.as_ref())
    };
    let Some(t) = first else {
        return fallback;
    };
    Timings {
        total: total_ms,
        ttfb: ms(t.blocked + t.dns + t.connecting + t.waiting),
        download: response
            .timings
            .as_ref()
            .map(|f| ms(f.receiving))
            .unwrap_or(0.0),
        dns: ms(t.dns),
        tcp: ms(t.connecting),
        tls: ms(t.tls_handshaking),
    }
}

/// Minimal base64 encoder (avoids another dependency for one call site).
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(n >> 18 & 63) as usize] as char);
        out.push(ALPHABET[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6 & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

// ── Mock server handlers ──────────────────────────────────────────────────────
async fn mock_register(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<MockRegister>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_token(&state, &headers)?;
    let id = payload.id.trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(err(StatusCode::BAD_REQUEST, "mock id must be alphanumeric/dash/underscore"));
    }
    if payload.routes.len() > MAX_MOCK_ROUTES {
        return Err(err(StatusCode::BAD_REQUEST, "too many mock routes"));
    }
    for r in &payload.routes {
        if r.method.parse::<Method>().is_err() {
            return Err(err(StatusCode::BAD_REQUEST, &format!("invalid method {:?}", r.method)));
        }
        if !r.path.starts_with('/') {
            return Err(err(StatusCode::BAD_REQUEST, "route path must start with '/'"));
        }
        if r.body.len() > MAX_REQUEST_BODY {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "mock body too large"));
        }
    }
    state
        .mocks
        .lock()
        .unwrap()
        .insert(id.clone(), payload.routes);
    Ok(Json(serde_json::json!({ "ok": true, "url": format!("/mock/{id}/") })))
}

async fn mock_unregister(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_token(&state, &headers)?;
    state.mocks.lock().unwrap().remove(&id);
    Ok(StatusCode::NO_CONTENT)
}

async fn mock_serve(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    axum::extract::Path((id, path)): axum::extract::Path<(String, String)>,
    req: axum::extract::Request,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    check_token(&state, &headers)?;
    let method = req.method().clone();
    let routes = state
        .mocks
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .unwrap_or_default();
    if routes.is_empty() {
        return Err(err(StatusCode::NOT_FOUND, "unknown mock server"));
    }

    let path = format!("/{}", path.trim_start_matches('/'));
    let route = routes
        .iter()
        .find(|r| r.method.eq_ignore_ascii_case(method.as_str()) && route_matches(&r.path, &path))
        .ok_or_else(|| {
            err(
                StatusCode::NOT_FOUND,
                &format!("no mock route for {} {}", method, path),
            )
        })?;

    if route.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(route.delay_ms.min(10_000))).await;
    }

    let mut builder = axum::response::Response::builder().status(StatusCode::from_u16(route.status).unwrap_or(StatusCode::OK));
    if !route.content_type.is_empty() {
        builder = builder.header(header::CONTENT_TYPE, &route.content_type);
    } else if !route.body.is_empty() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    for h in &route.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(h.key.as_bytes()),
            HeaderValue::from_str(&h.value),
        ) {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(axum::body::Body::from(route.body.clone()))
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "failed to build mock response"))
}

/// Match a route pattern against a concrete path: literal segments,
/// `:param` consumes one segment, `*` consumes the rest.
fn route_matches(pattern: &str, path: &str) -> bool {
    let pat: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    let seg: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let mut pi = 0;
    let mut si = 0;
    while pi < pat.len() {
        match pat[pi] {
            "*" => return true,
            p => {
                if si >= seg.len() {
                    return false;
                }
                if !p.starts_with(':') && p != seg[si] {
                    return false;
                }
                pi += 1;
                si += 1;
            }
        }
    }
    si == seg.len()
}

// ── Server ───────────────────────────────────────────────────────────────────
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let origins_env = std::env::var("KP_RELAY_ORIGINS").ok().filter(|s| !s.trim().is_empty());
    
    // Explicit origin list when configured; otherwise any localhost port (dev).
    let cors = match origins_env {
        Some(raw) => {
            let origins: Vec<header::HeaderValue> = raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .filter_map(|o| o.parse().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods(AllowMethods::any())
                .allow_headers(AllowHeaders::any())
        }
        None => CorsLayer::new()
            .allow_origin(AllowOrigin::predicate(
                |origin: &header::HeaderValue, _parts: &axum::http::request::Parts| {
                    origin
                        .to_str()
                        .map(|o| {
                            o.starts_with("http://localhost:")
                                || o.starts_with("http://127.0.0.1:")
                                || o.starts_with("https://localhost:")
                                || o.starts_with("https://127.0.0.1:")
                        })
                        .unwrap_or(false)
                },
            ))
            .allow_methods(AllowMethods::any())
            .allow_headers(AllowHeaders::any()),
    };

    let blocklist: Vec<IpCidr> = parse_blacklist(
        &SSRF_BLOCKLIST
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>(),
    );
    let http_config = HttpConfig {
        // tropel-http follows redirects MANUALLY so every hop is re-checked
        // against `blacklist_ips` — the same SSRF model the relay had, reused.
        max_redirects: MAX_REDIRECTS,
        request_timeout: Some("30s".to_string()),
        user_agent: "knockport-relay/0.1".to_string(),
        // Proxy caps, enforced while streaming (redirect-hop bodies included).
        max_response_bytes: Some(MAX_RESPONSE_BODY as u64),
        // Relay security model needs a FRESH resolution per request (the old
        // relay re-resolved every time); tropel-http's k6 default caches DNS
        // for 5 minutes, so disable the cache.
        dns_ttl: Some("0s".to_string()),
        // SSRF: never connect to non-public ranges (loopback/private/
        // link-local/broadcast/CGNAT/ULA, v4-mapped included). The DNS
        // resolver rejects an answer whose addresses all fall inside these;
        // IP-literal hosts are rejected before any connect attempt.
        blacklist_ips: SSRF_BLOCKLIST.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    };
    let client =
        HttpClient::new(&http_config).expect("failed to build tropel-http client");

    let token = std::env::var("KP_RELAY_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    let state = Arc::new(AppState {
        client,
        blocklist,
        metrics: Metrics::default(),
        rate: Mutex::new(HashMap::new()),
        token,
        mocks: Mutex::new(HashMap::new()),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/proxy", post(proxy))
        .route("/mock/register", post(mock_register))
        .route("/mock/{id}", delete(mock_unregister))
        .route("/mock/{id}/{*path}", any(mock_serve))
        .layer(cors)
        .with_state(state);

    let bind: SocketAddr = format!("0.0.0.0:{port}").parse().expect("invalid bind address");
    info!(%bind, service = "knockport-relay", "listening");
    let listener = tokio::net::TcpListener::bind(bind).await.expect("bind failed");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("server crashed");
}

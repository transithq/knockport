//! KnockPort CORS relay.
//!
//! Forwards browser API requests server-side so the web tier isn't blocked by
//! CORS. Scope is API-client traffic only — never load testing (see
//! KNOCKPORT_ARCHITECTURE.md §5b).
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

// ── Caps (architecture doc §5b) ──────────────────────────────────────────────
const MAX_REQUEST_BODY: usize = 10 * 1024 * 1024; // 10 MB
const MAX_RESPONSE_BODY: usize = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS: usize = 5;
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
    client: reqwest::Client,
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

// ── SSRF protection ──────────────────────────────────────────────────────────
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                // CGNAT 100.64.0.0/10
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // unique local fc00::/7
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // link local fe80::/10
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // v4-mapped addresses re-checked as v4
                || v6.to_ipv4_mapped().is_some_and(|v4| is_blocked_ip(IpAddr::V4(v4)))
        }
    }
}

/// Resolve the host and reject if ANY resolved address is blocked
/// (defeats mixed-answer DNS rebinding attempts).
async fn ssrf_check(url: &url::Url) -> Result<(), &'static str> {
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("scheme not allowed"),
    }
    let host = url.host_str().ok_or("missing host")?;
    let port = url.port_or_known_default().ok_or("missing port")?;

    // Literal IP hosts are checked directly.
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if is_blocked_ip(ip) {
            Err("target address is blocked")
        } else {
            Ok(())
        };
    }

    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| "dns resolution failed")?
        .collect();
    if addrs.is_empty() {
        return Err("dns resolution returned no addresses");
    }
    for addr in &addrs {
        if is_blocked_ip(addr.ip()) {
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
    ssrf_check(&url)
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

    let method: Method = payload
        .method
        .parse()
        .map_err(|_| err(StatusCode::BAD_REQUEST, "invalid method"))?;

    let started = Instant::now();
    state.metrics.requests.fetch_add(1, Ordering::Relaxed);
    state.metrics.bytes_in.fetch_add(body_bytes.len() as u64, Ordering::Relaxed);

    // Redirects are followed manually so every hop is SSRF re-checked.
    let mut current_url = url;
    let mut current_method = method;
    let mut current_body = body_bytes;
    let headers_at_send = payload.headers.clone();
    let mut ttfb = 0.0;
    let mut redirect_hops = 0usize;

    let response = loop {
        let mut builder = state
            .client
            .request(current_method.clone(), current_url.as_str());

        for pair in &headers_at_send {
            let name = pair.key.to_ascii_lowercase();
            if name == "host" || name == "content-length" || HOP_HEADERS.contains(&name.as_str()) {
                continue;
            }
            if multipart_ct.is_some() && name == "content-type" {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(pair.key.as_bytes()),
                HeaderValue::from_str(&pair.value),
            ) {
                builder = builder.header(name, value);
            }
        }
        if let Some(ct) = &multipart_ct {
            builder = builder.header(header::CONTENT_TYPE, ct.clone());
        }
        if !current_body.is_empty() && current_method != Method::GET && current_method != Method::HEAD {
            builder = builder.body(current_body.clone());
        }

        let resp = builder
            .send()
            .await
            .map_err(|_| err(StatusCode::BAD_GATEWAY, "upstream request failed"))?;

        if ttfb == 0.0 {
            ttfb = started.elapsed().as_secs_f64() * 1000.0;
        }

        let status = resp.status();
        let is_redirect = matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308)
            && resp.headers().get(header::LOCATION).is_some();
        if is_redirect {
            redirect_hops += 1;
            if redirect_hops > MAX_REDIRECTS {
                state.metrics.failures.fetch_add(1, Ordering::Relaxed);
                return Err(err(StatusCode::BAD_GATEWAY, "too many redirects"));
            }

            let location = resp
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            drop(resp);

            let next = current_url
                .join(&location)
                .map_err(|_| err(StatusCode::BAD_GATEWAY, "invalid redirect location"))?;
            // Every hop is re-checked against the SSRF blocklist.
            ssrf_check(&next)
                .await
                .map_err(|reason| err(StatusCode::FORBIDDEN, reason))?;

            // 301/302/303 downgrade to GET and drop the body (RFC 7231).
            if matches!(status.as_u16(), 301 | 302 | 303) {
                current_method = Method::GET;
                current_body.clear();
            }
            current_url = next;
            continue;
        }
        break resp;
    };

    let status = response.status();
    let response_headers: Vec<HeaderPair> = response
        .headers()
        .iter()
        .filter(|(name, _)| {
            let n = name.as_str();
            !HOP_HEADERS.contains(&n) && n != "content-encoding" && n != "content-length"
        })
        .map(|(name, value)| HeaderPair {
            key: name.to_string(),
            value: value.to_str().unwrap_or("").to_string(),
        })
        .collect();

    // Stream the body with a hard cap.
    let mut body: Vec<u8> = Vec::new();
    let mut stream = response;
    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|_| err(StatusCode::BAD_GATEWAY, "upstream stream error"))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BODY {
            state.metrics.failures.fetch_add(1, Ordering::Relaxed);
            return Err(err(StatusCode::BAD_GATEWAY, "response body too large"));
        }
        body.extend_from_slice(&chunk);
    }

    let total = started.elapsed().as_secs_f64() * 1000.0;
    state.metrics.bytes_out.fetch_add(body.len() as u64, Ordering::Relaxed);
    state.metrics.total_ms.fetch_add(total as u64, Ordering::Relaxed);

    let (body_text, encoding) = match String::from_utf8(body.clone()) {
        Ok(text) => (text, "utf8"),
        Err(_) => (base64_encode(&body), "base64"),
    };

    Ok(Json(ProxyResponse {
        status: status.as_u16(),
        status_text: status
            .canonical_reason()
            .unwrap_or("")
            .to_string(),
        headers: response_headers,
        body: body_text,
        encoding,
        timings: Timings { total, ttfb },
    }))
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

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none()) // redirects handled with SSRF re-checks
        .build()
        .expect("failed to build http client");

    let token = std::env::var("KP_RELAY_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    let state = Arc::new(AppState {
        client,
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

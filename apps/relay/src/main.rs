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
    routing::{get, post},
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
}

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

// ── Handlers ─────────────────────────────────────────────────────────────────
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "service": "knockport-relay" }))
}

async fn metrics(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let m = &state.metrics;
    Json(serde_json::json!({
        "requests": m.requests.load(Ordering::Relaxed),
        "failures": m.failures.load(Ordering::Relaxed),
        "bytes_in": m.bytes_in.load(Ordering::Relaxed),
        "bytes_out": m.bytes_out.load(Ordering::Relaxed),
        "total_ms_sum": m.total_ms.load(Ordering::Relaxed),
    }))
}

async fn proxy(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ProxyRequest>,
) -> Result<Json<ProxyResponse>, (StatusCode, Json<serde_json::Value>)> {
    let ip = addr.ip();
    if rate_limited(&state, ip) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded"));
    }

    let url = url::Url::parse(&payload.url).map_err(|_| err(StatusCode::BAD_REQUEST, "invalid url"))?;
    ssrf_check(&url)
        .await
        .map_err(|reason| err(StatusCode::FORBIDDEN, reason))?;

    let body_bytes = match &payload.body {
        Some(b) if b.len() > MAX_REQUEST_BODY => {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "request body too large"))
        }
        Some(b) => b.as_bytes().to_vec(),
        None => Vec::new(),
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
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(pair.key.as_bytes()),
                HeaderValue::from_str(&pair.value),
            ) {
                builder = builder.header(name, value);
            }
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

    let state = Arc::new(AppState {
        client,
        metrics: Metrics::default(),
        rate: Mutex::new(HashMap::new()),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/proxy", post(proxy))
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

import type { MediaKind, ResponseCookie } from "@knockport/core";
import { mediaKind, normalizeContentType, query } from "@knockport/core";
import { clsx } from "clsx";
import { Check, ChevronDown, Copy, Download, PanelBottom, PanelRight, Play, Save, Trash2, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LARGE_RESPONSE_BYTES, useAppStore } from "../../store/app-store";
import { CodeViewer, type ViewerLanguage } from "../common/CodeViewer";
import {
  downloadResponseBase64,
  downloadResponseText,
  filenameForResponse,
} from "./response-export";
import { type ResponseFormat, detectResponseFormat, formatLabel } from "./response-format";

type ViewTab = "pretty" | "raw" | "preview";

const methodColor: Record<string, string> = {
  GET: "#22c55e",
  POST: "#f59e0b",
  PUT: "#3b82f6",
  PATCH: "#a855f7",
  DELETE: "#ef4444",
  HEAD: "#64748b",
  OPTIONS: "#64748b",
};

/** Viewer language for each format (XML/HTML fall back to text highlighting). */
function viewerLanguageFor(format: ResponseFormat): ViewerLanguage {
  if (format === "json") return "json";
  if (format === "javascript") return "javascript";
  return "text";
}

/** Pretty-print a body for the given format; fall back to raw on error. */
async function formatBody(body: string, format: ResponseFormat): Promise<string> {
  switch (format) {
    case "json": {
      try {
        return JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        return body;
      }
    }
    case "xml":
    case "html": {
      try {
        const { default: xmlFormat } = await import("xml-formatter");
        return xmlFormat(body, { indentation: "  ", collapseContent: true, lineSeparator: "\n" });
      } catch {
        return body;
      }
    }
    default:
      return body;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

// ── HTML preview helpers ─────────────────────────────────────────────────────
function isHtmlContent(contentType: string | undefined, body: string): boolean {
  if (contentType?.toLowerCase().includes("html")) return true;
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

/** Inject a <base> so relative URLs resolve against the request URL. */
function injectBase(html: string, requestUrl: string): string {
  const safe = requestUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const base = `<base href="${safe}">`;
  const lower = html.toLowerCase();
  for (const tag of ["<head", "<html"]) {
    const idx = lower.indexOf(tag);
    if (idx !== -1) {
      const close = html.indexOf(">", idx);
      if (close !== -1) return html.slice(0, close + 1) + base + html.slice(close + 1);
    }
  }
  return base + html;
}

function PreviewFrame({
  body,
  contentType,
  requestUrl,
}: { body: string; contentType?: string; requestUrl: string }) {
  const doc = useMemo(
    () =>
      isHtmlContent(contentType, body)
        ? injectBase(body, requestUrl)
        : `<!doctype html><html><body><div style="font:13px/1.6 system-ui;color:#666;padding:32px">Preview is available for HTML responses.</div></body></html>`,
    [body, contentType, requestUrl],
  );
  return <iframe title="preview" className="kp-preview-frame" srcDoc={doc} sandbox="" />;
}

// ── Format selector (JSON dropdown) ─────────────────────────────────────────
const FORMAT_OPTIONS: ResponseFormat[] = ["json", "xml", "html", "javascript", "text"];

function FormatSelector({
  format,
  onChange,
}: { format: ResponseFormat; onChange: (f: ResponseFormat) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="kp-format-selector" ref={ref}>
      <button
        type="button"
        className="kp-lang-btn"
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          if (!ref.current?.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        {formatLabel(format)} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="kp-format-menu">
          {FORMAT_OPTIONS.map((f) => (
            <button
              key={f}
              type="button"
              className={clsx("kp-format-menu-item", f === format && "active")}
              onClick={() => {
                onChange(f);
                setOpen(false);
              }}
            >
              {formatLabel(f)}
              {f === format && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cookies table ────────────────────────────────────────────────────────────
function CookieCard({ cookie }: { cookie: ResponseCookie }) {
  const attrs: [string, string][] = [];
  if (cookie.domain) attrs.push(["Domain", cookie.domain]);
  if (cookie.path) attrs.push(["Path", cookie.path]);
  if (cookie.expires) attrs.push(["Expires", cookie.expires]);
  if (cookie.maxAge !== undefined) attrs.push(["Max-Age", String(cookie.maxAge)]);
  if (cookie.sameSite) attrs.push(["SameSite", cookie.sameSite]);
  if (cookie.httpOnly) attrs.push(["HttpOnly", "true"]);
  if (cookie.secure) attrs.push(["Secure", "true"]);

  return (
    <div className="kp-cookie-card">
      <div className="kp-cookie-main">
        <span className="kp-kv-key">{cookie.name}</span>
        <span className="kp-cookie-val kp-mono">{cookie.value}</span>
      </div>
      {attrs.length > 0 && (
        <div className="kp-cookie-attrs">
          {attrs.map(([k, v]) => (
            <span className="kp-cookie-attr" key={k}>
              {k}={v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Media lens (F1) ──────────────────────────────────────────────────────────
/** Render a base64 media body through a blob URL. Revoked on unmount. */
function MediaLens({
  kind,
  mime,
  base64,
}: { kind: MediaKind; mime: string; base64: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setUrl(objectUrl);
    } catch {
      setUrl(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [base64, mime]);

  if (!url) {
    return (
      <div className="kp-empty-center">
        <p className="kp-empty-title">Unable to render {kind}</p>
        <p className="kp-empty-sub">The response body could not be decoded as {mime}</p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="kp-media-lens kp-scroll">
        <img src={url} alt="response image" />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="kp-media-lens kp-media-center">
        <audio controls src={url} />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="kp-media-lens kp-media-center">
        <video controls src={url} />
      </div>
    );
  }
  // PDF: a blob URL in a sandboxed iframe (data: URLs are blocked for PDFs).
  return (
    <iframe
      title="response-pdf"
      className="kp-media-pdf"
      src={url}
      sandbox=""
    />
  );
}

// ── Body panel ───────────────────────────────────────────────────────────────
function BodyPanel({
  tabId,
  response,
}: {
  tabId: string;
  response: {
    body: string;
    bodyBase64?: string;
    contentType?: string;
    bodySize: number;
    url?: string;
  };
}) {
  const requestUrl = useAppStore((s) => s.requests[tabId]?.url ?? "");
  const largeDismissed = useAppStore((s) => s.largeBodyDismissed[tabId] === true);
  const dismissLargeBody = useAppStore((s) => s.dismissLargeBody);

  const detected = useMemo(
    () => detectResponseFormat(response.contentType, response.body),
    [response.contentType, response.body],
  );
  const [format, setFormat] = useState<ResponseFormat | null>(null);
  const activeFormat: ResponseFormat = format ?? detected.format;
  const [viewTab, setViewTab] = useState<ViewTab>("pretty");
  const [copied, setCopied] = useState(false);
  const [userWrap, setUserWrap] = useState<boolean>(
    () => typeof localStorage !== "undefined" && localStorage.getItem("kp-response-wrap") === "1",
  );
  const setWrapPref = (on: boolean) => {
    setUserWrap(on);
    try {
      localStorage.setItem("kp-response-wrap", on ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  const prettyText = useMemo(() => {
    let result = response.body;
    // Synchronous pretty for JSON (the common case); xml/html run through
    // the async formatter below.
    if (activeFormat === "json") {
      try {
        result = JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {
        result = response.body;
      }
    }
    return result;
  }, [response.body, activeFormat]);

  // XML / HTML pretty-printing is async (lazy xml-formatter import).
  const [asyncPretty, setAsyncPretty] = useState<string | null>(null);
  useEffect(() => {
    if (activeFormat !== "xml" && activeFormat !== "html") {
      setAsyncPretty(null);
      return;
    }
    let cancelled = false;
    setAsyncPretty(null);
    void formatBody(response.body, activeFormat).then((t) => {
      if (!cancelled) setAsyncPretty(t);
    });
    return () => {
      cancelled = true;
    };
  }, [response.body, activeFormat]);

  const displayText =
    activeFormat === "xml" || activeFormat === "html" ? (asyncPretty ?? prettyText) : prettyText;

  const wrap = userWrap || viewTab === "raw";
  // F6 large-response guard: rendering multi-MB bodies through CodeMirror
  // freezes the UI thread, so hold them behind an explicit "show anyway".
  // The dismissal is per tab and resets when a new response lands (the send
  // path clears it before storing the response).
  const guarded = response.bodySize > LARGE_RESPONSE_BYTES && !largeDismissed;

  // F1 media lens: when the response carries renderable bytes, show the
  // native preview instead of the pretty/raw/preview text pipeline.
  const detectedMedia = mediaKind(response.contentType);
  const media = detectedMedia !== null && response.bodyBase64 ? detectedMedia : null;
  const mime = normalizeContentType(response.contentType);

  // F2 body filter (bruno-query port): a dot-path expression evaluated
  // against parsed JSON. Only offered for JSON bodies.
  const [filterQuery, setFilterQuery] = useState("");
  const filterActive = activeFormat === "json" && filterQuery.trim() !== "";
  let filterResult: string | null = null;
  let filterError: string | null = null;
  if (filterActive) {
    try {
      filterResult = JSON.stringify(
        query(JSON.parse(response.body), filterQuery.trim()),
        null,
        2,
      );
    } catch (e) {
      filterError = e instanceof Error ? e.message : String(e);
    }
  }

  const saveBody = async () => {
    if (media) {
      downloadResponseBase64(response.bodyBase64!, response.url ?? requestUrl, response.contentType);
      return;
    }
    const text = await formatBody(response.body, activeFormat);
    const name = filenameForResponse(response.url ?? requestUrl, response.contentType, text);
    downloadResponseText(text, name, response.contentType);
  };

  const copyBody = async () => {
    try {
      const text = await formatBody(response.body, activeFormat);
      await navigator.clipboard.writeText(text);
    } catch {
      await navigator.clipboard.writeText(response.body).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (media) {
    return (
      <>
        <div className="kp-view-row">
          <span className="kp-media-badge">{mime}</span>
        </div>
        <MediaLens kind={media} mime={mime} base64={response.bodyBase64!} />
        <div className="kp-body-statusbar">
          <span>{mime}</span>
          <span className="kp-status-right">
            <span>Size: {formatSize(response.bodySize)}</span>
            <button type="button" className="kp-save-btn" title="Download the media body" onClick={saveBody}>
              <Download size={13} /> Save
            </button>
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="kp-view-row">
        <div className="kp-seg-row">
          {(["pretty", "raw", "preview"] as ViewTab[]).map((v) => (
            <button
              key={v}
              type="button"
              className={clsx("kp-seg", viewTab === v && "active")}
              onClick={() => setViewTab(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {activeFormat === "json" && (
          <div className="kp-query-box">
            <span className="kp-query-label">Filter</span>
            <input
              className="kp-text-input kp-query-input"
              placeholder="..items[0].amount"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              spellCheck={false}
            />
            {filterQuery && (
              <button
                type="button"
                className="kp-icon-btn"
                title="Clear filter"
                onClick={() => setFilterQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        <FormatSelector format={activeFormat} onChange={(f) => setFormat(f)} />
      </div>

      {guarded && (
        <div className="kp-large-body-guard">
          <p className="kp-large-body-title">Large response body</p>
          <p className="kp-large-body-sub">
            {formatSize(response.bodySize)} of {formatLabel(activeFormat)} — rendering it may make
            the app unresponsive. You can still download it below.
          </p>
          <div className="kp-large-body-actions">
            <button
              type="button"
              className="kp-btn primary"
              onClick={() => dismissLargeBody(tabId)}
            >
              Show anyway
            </button>
            <button type="button" className="kp-btn" onClick={saveBody}>
              <Download size={13} /> Download
            </button>
          </div>
        </div>
      )}

      {filterActive && filterError && (
        <div className="kp-query-error">Query error: {filterError}</div>
      )}
      {filterActive && !filterError && (
        <CodeViewer value={filterResult ?? ""} language="json" wrap={wrap} />
      )}

      {!filterActive && !guarded && viewTab === "pretty" && (
        <CodeViewer value={displayText} language={viewerLanguageFor(activeFormat)} wrap={wrap} />
      )}
      {!filterActive && !guarded && viewTab === "raw" && <CodeViewer value={response.body} language="text" wrap />}
      {!filterActive && !guarded && viewTab === "preview" && (
        <PreviewFrame
          body={response.body}
          contentType={response.contentType}
          requestUrl={response.url ?? requestUrl}
        />
      )}

      <div className="kp-body-statusbar">
        <span>
          {filterActive ? (
            <>
              <span className="kp-query-label">Filter</span> {filterQuery.trim()}
              {filterError === null && <span className="kp-hint"> · {formatSize(new TextEncoder().encode(filterResult ?? "").length)}</span>}
            </>
          ) : (
            <>
              {formatLabel(activeFormat)}
              {format === null && <span className="kp-hint"> · auto-detected</span>}
            </>
          )}
        </span>
        <span className="kp-status-right">
          <button
            type="button"
            className={clsx("kp-icon-btn", userWrap && "active")}
            title={userWrap ? "Turn off word wrap" : "Turn on word wrap"}
            aria-pressed={userWrap}
            onClick={() => setWrapPref(!userWrap)}
          >
            <WrapText size={13} />
          </button>
          <span>Size: {formatSize(response.bodySize)}</span>
          <button type="button" className="kp-save-btn" title="Download the formatted response" onClick={saveBody}>
            <Download size={13} /> Save
          </button>
          <button type="button" className="kp-save-btn" title="Copy the formatted response" onClick={copyBody}>
            {copied ? <Check size={13} /> : <Copy size={13} />} Copy
          </button>
        </span>
      </div>
    </>
  );
}

// ── Response Body (left-bottom panel) ────────────────────────────────────────
export function ResponseBody({ tabId }: { tabId: string }) {
  const responses = useAppStore((s) => s.responses);
  const testResults = useAppStore((s) => s.testResults[tabId]);
  const responseLayout = useAppStore((s) => s.responseLayout);
  const setResponseLayout = useAppStore((s) => s.setResponseLayout);
  const response = responses[tabId];
  // Response tab lives in the store so cross-component CTAs (e.g. "View all
  // headers" in the analytics column) can drive it, and it sticks across
  // request tab switches like the request panel does.
  const bodyTab = useAppStore((s) => s.activeResponsePanel);
  const setBodyTab = useAppStore((s) => s.setActiveResponsePanel);
  // F4 request examples: stored on the request object (tab copy).
  const requestExamples = useAppStore((s) => s.requests[tabId]?.examples ?? []);
  const saveExample = useAppStore((s) => s.saveRequestExample);
  const deleteExample = useAppStore((s) => s.deleteRequestExample);
  const deleteAllExamples = useAppStore((s) => s.deleteAllRequestExamples);
  const openExample = useAppStore((s) => s.openRequestExample);

  if (!response) {
    return (
      <div className="kp-response-body">
        <div className="kp-empty-center">
          <p className="kp-empty-title">No response yet</p>
          <p className="kp-empty-sub">Send a request to see the response</p>
        </div>
      </div>
    );
  }

  const headerCount = Object.keys(response.headers).length;

  return (
    <div className="kp-response-body">
      {/* Top tabs */}
      <div className="kp-req-tabs">
        <button
          type="button"
          className={clsx("kp-req-tab", bodyTab === "body" && "active")}
          onClick={() => setBodyTab("body")}
        >
          Body
        </button>
        <button
          type="button"
          className={clsx("kp-req-tab", bodyTab === "cookies" && "active")}
          onClick={() => setBodyTab("cookies")}
        >
          Cookies{" "}
          {response.cookies.length > 0 && (
            <span className="kp-tab-count">{response.cookies.length}</span>
          )}
        </button>
        <button
          type="button"
          className={clsx("kp-req-tab", bodyTab === "headers" && "active")}
          onClick={() => setBodyTab("headers")}
        >
          Headers <span className="kp-tab-count">{headerCount}</span>
        </button>
        <button
          type="button"
          className={clsx("kp-req-tab", bodyTab === "tests" && "active")}
          onClick={() => setBodyTab("tests")}
        >
          Test Results{" "}
          {testResults && testResults.tests.length > 0 && (
            <span className="kp-tab-count">
              {testResults.passed}/{testResults.tests.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={clsx("kp-req-tab", bodyTab === "examples" && "active")}
          onClick={() => setBodyTab("examples")}
        >
          Examples{" "}
          {requestExamples.length > 0 && <span className="kp-tab-count">{requestExamples.length}</span>}
        </button>
        <span className="kp-req-tabs-spacer" />
        <button
          type="button"
          className="kp-icon-btn kp-layout-toggle"
          title={responseLayout === "below" ? "Show response beside the request" : "Show response below the request"}
          aria-pressed={responseLayout === "beside"}
          onClick={() => setResponseLayout(responseLayout === "below" ? "beside" : "below")}
        >
          {responseLayout === "below" ? <PanelRight size={14} /> : <PanelBottom size={14} />}
        </button>
      </div>

      {bodyTab === "body" && <BodyPanel tabId={tabId} response={response} />}

      {bodyTab === "headers" && (
        <div className="kp-headers-list">
          {Object.entries(response.headers).map(([k, v]) => (
            <div className="kp-headers-row" key={k}>
              <span className="kp-headers-key">{k}</span>
              <span className="kp-headers-val kp-mono">{v}</span>
            </div>
          ))}
        </div>
      )}

      {bodyTab === "cookies" && (
        <div className="kp-cookies-list kp-scroll">
          {response.cookies.length === 0 && <p className="kp-hint">No cookies in this response</p>}
          {response.cookies.map((c, i) => (
            <CookieCard key={`${c.name}-${i}`} cookie={c} />
          ))}
        </div>
      )}

      {bodyTab === "tests" && (
        <div className="kp-tests-list kp-scroll">
          {!testResults && (
            <div className="kp-empty-center">
              <p className="kp-empty-sub">No tests were run for this request</p>
              <p className="kp-empty-sub">
                Add a test script or assertions in the Scripts / Tests tabs
              </p>
            </div>
          )}
          {testResults && (
            <>
              <div className="kp-tests-summary">
                <span
                  className={`kp-runner-status ${testResults.failed === 0 && !testResults.scriptError ? "ok" : "fail"}`}
                >
                  {testResults.failed === 0 && !testResults.scriptError ? "PASS" : "FAIL"}
                </span>
                <span className="kp-hint">
                  {testResults.passed}/{testResults.tests.length} passed •{" "}
                  {testResults.duration.toFixed(1)} ms
                </span>
              </div>
              {testResults.scriptError && (
                <div className="kp-test-error">Script error: {testResults.scriptError}</div>
              )}
              {testResults.tests.length === 0 && !testResults.scriptError && (
                <p className="kp-hint">The script defined no tests.</p>
              )}
              {testResults.tests.map((t, i) => (
                <div className="kp-test-row" key={i}>
                  <span className={`kp-runner-status ${t.passed ? "ok" : "fail"}`}>
                    {t.passed ? "PASS" : "FAIL"}
                  </span>
                  <span className="kp-test-name">{t.name}</span>
                  {t.message && <span className="kp-test-msg kp-mono">{t.message}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {bodyTab === "examples" && (
        <div className="kp-examples-list kp-scroll">
          <div className="kp-examples-toolbar">
            <span className="kp-hint">
              Saved request + response pairs for this request
            </span>
            <button
              type="button"
              className="kp-btn small"
              disabled={!response}
              title="Save the current request and response as an example"
              onClick={() => saveExample(tabId)}
            >
              <Save size={13} /> Save current
            </button>
            {requestExamples.length > 0 && (
              <button
                type="button"
                className="kp-btn small danger"
                title="Delete all saved examples"
                onClick={() => deleteAllExamples(tabId)}
              >
                <Trash2 size={13} /> Clear all
              </button>
            )}
          </div>
          {requestExamples.length === 0 && (
            <div className="kp-empty-center">
              <p className="kp-empty-title">No saved examples</p>
              <p className="kp-empty-sub">Send a request, then save it as an example</p>
            </div>
          )}
          {requestExamples.map((ex) => (
            <div className="kp-example-row" key={ex.id}>
              <div className="kp-example-main">
                <span className="kp-example-method" style={{ color: methodColor[ex.request.method] }}>
                  {ex.request.method}
                </span>
                <span className="kp-example-url kp-mono">{ex.request.url || ex.request.name}</span>
                <span className="kp-example-meta">
                  {ex.response.status} {ex.response.statusText} ·{" "}
                  {new Date(ex.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="kp-example-actions">
                <button
                  type="button"
                  className="kp-btn small"
                  title="Open this example's request and response"
                  onClick={() => openExample(ex)}
                >
                  <Play size={13} /> Open
                </button>
                <button
                  type="button"
                  className="kp-icon-btn kp-icon-btn-danger"
                  title="Delete this example"
                  onClick={() => deleteExample(tabId, ex.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

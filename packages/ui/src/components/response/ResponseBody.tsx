import type { ResponseCookie } from "@knockport/core";
import { clsx } from "clsx";
import { Check, ChevronDown, Copy, Download, WrapText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { CodeViewer, type ViewerLanguage } from "../common/CodeViewer";
import { downloadResponseText, filenameForResponse } from "./response-export";
import { type ResponseFormat, detectResponseFormat, formatLabel } from "./response-format";

type BodyTab = "body" | "cookies" | "headers" | "tests";
type ViewTab = "pretty" | "raw" | "preview";

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

// ── Body panel ───────────────────────────────────────────────────────────────
function BodyPanel({
  tabId,
  response,
}: {
  tabId: string;
  response: { body: string; contentType?: string; bodySize: number; url?: string };
}) {
  const requestUrl = useAppStore((s) => s.requests[tabId]?.url ?? "");

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

  const saveBody = async () => {
    const text = await formatBody(response.body, activeFormat);
    const name = filenameForResponse(response.url ?? requestUrl, response.contentType, text);
    downloadResponseText(text, name, response.contentType);
  };

  const wrap = userWrap || viewTab === "raw";

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
        <FormatSelector format={activeFormat} onChange={(f) => setFormat(f)} />
      </div>

      {viewTab === "pretty" && (
        <CodeViewer value={displayText} language={viewerLanguageFor(activeFormat)} wrap={wrap} />
      )}
      {viewTab === "raw" && <CodeViewer value={response.body} language="text" wrap />}
      {viewTab === "preview" && (
        <PreviewFrame
          body={response.body}
          contentType={response.contentType}
          requestUrl={response.url ?? requestUrl}
        />
      )}

      <div className="kp-body-statusbar">
        <span>
          {formatLabel(activeFormat)}
          {format === null && <span className="kp-hint"> · auto-detected</span>}
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
  const response = responses[tabId];
  const [bodyTab, setBodyTab] = useState<BodyTab>("body");

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
      </div>

      {bodyTab === "body" && <BodyPanel tabId={tabId} response={response} />}

      {bodyTab === "headers" && (
        <div className="kp-kv-list kp-scroll">
          {Object.entries(response.headers).map(([k, v]) => (
            <div className="kp-kv-list-row" key={k}>
              <span className="kp-kv-key">{k}</span>
              <span className="kp-kv-val kp-mono">{v}</span>
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
    </div>
  );
}

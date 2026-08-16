// Response body format detection, modeled on Bruno's getDefaultResponseFormat
// (utils/response/index.js): normalize the Content-Type header, map it to a
// display format, and sniff JSON when the declared type is ambiguous.

export type ResponseFormat = "json" | "xml" | "html" | "javascript" | "text";

export interface FormatDetection {
  /** Display format to use by default. */
  format: ResponseFormat;
  /** True when the format is a confident header-based match (not a sniff). */
  confident: boolean;
}

const JSON_PATTERN = /^text\/(json|.*\+json)$|^application\/(json|.*\+json)$/i;
const XML_PATTERN = /^(text|application)\/(xml|.*\+xml)$/i;
const HTML_PATTERN = /^(text\/html|application\/xhtml\+xml)$/i;
const JAVASCRIPT_PATTERN = /^(application|text)\/(javascript|ecmascript|x-javascript)$/i;
const TEXT_PATTERN = /^text\//i;

/** Strip parameters like "; charset=utf-8". */
function primaryContentType(contentType?: string): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Sniff a JSON body by probing the trimmed head with JSON.parse. */
function looksLikeJson(body: string): boolean {
  const t = body.trimStart();
  if (t === "" || (t[0] !== "{" && t[0] !== "[")) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the display format for a response. Header wins; when the header is
 * absent or generic (text/*), sniff the body for JSON and fall back to text.
 */
export function detectResponseFormat(
  contentType: string | undefined,
  body: string,
): FormatDetection {
  const ct = primaryContentType(contentType);

  if (JSON_PATTERN.test(ct)) return { format: "json", confident: true };
  if (XML_PATTERN.test(ct)) return { format: "xml", confident: true };
  if (HTML_PATTERN.test(ct)) return { format: "html", confident: true };
  if (JAVASCRIPT_PATTERN.test(ct)) return { format: "javascript", confident: true };

  // Header says text/* (or missing): sniff for JSON before falling back.
  if (TEXT_PATTERN.test(ct) || ct === "") {
    if (looksLikeJson(body)) return { format: "json", confident: ct !== "" };
    return { format: "text", confident: ct !== "" };
  }

  return { format: "text", confident: false };
}

/** Human label for a format, used in the format selector button. */
export function formatLabel(format: ResponseFormat): string {
  const map: Record<ResponseFormat, string> = {
    json: "JSON",
    xml: "XML",
    html: "HTML",
    javascript: "JavaScript",
    text: "Text",
  };
  return map[format];
}

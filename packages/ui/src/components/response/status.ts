// ── HTTP status helpers (Hoppscotch H§15 parity) ─────────────────────────────
// Group coloring uses the existing --kp-status-* theme tokens (see
// styles/globals.css). The phrase table follows the IANA HTTP Status
// Registry names so UIs can render "200 OK" even when the transport
// dropped the reason phrase (HTTP/2 never carries one).

export type StatusGroup = "2xx" | "3xx" | "4xx" | "5xx";

/** Classify a status code into its group; null for errors/0/unknown ranges. */
export function statusGroup(status: number): StatusGroup | null {
  if (!Number.isFinite(status) || status <= 0) return null;
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return null;
}

/** Theme color for a status code; undefined when there is no group to color. */
export function statusGroupColor(status: number): string | undefined {
  switch (statusGroup(status)) {
    case "2xx":
      return "var(--kp-status-2xx)";
    case "3xx":
      return "var(--kp-status-3xx)";
    case "4xx":
      return "var(--kp-status-4xx)";
    case "5xx":
      return "var(--kp-status-5xx)";
    default:
      return undefined;
  }
}

const STATUS_PHRASES: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

/** IANA reason phrase for a status code; "" when unknown. */
export function statusPhrase(status: number): string {
  return STATUS_PHRASES[status] ?? "";
}

/**
 * "200 OK"-style label. Prefers the server-supplied reason phrase; falls back
 * to the IANA table (covers HTTP/2, which strips reason phrases); returns the
 * bare code when nothing else is available.
 */
export function statusLabel(status: number, statusText?: string): string {
  const phrase = statusText?.trim() || statusPhrase(status);
  return phrase ? `${status} ${phrase}` : `${status}`;
}

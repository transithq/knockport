// Response export helpers: derive a sensible filename from the request URL
// and content type, and trigger a browser download of the body.

import { detectResponseFormat, type ResponseFormat } from "./response-format";

const EXTENSIONS: Record<ResponseFormat, string> = {
  json: ".json",
  xml: ".xml",
  html: ".html",
  javascript: ".js",
  text: ".txt",
};

/** Sanitize a string into a safe filename stem. */
function sanitize(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Last URL path segment, or "response" when the URL has no useful path. */
export function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    const stem = seg ? sanitize(seg.replace(/\.[a-z0-9]+$/i, "")) : "";
    return stem || "response";
  } catch {
    return "response";
  }
}

/** Filename for a response: URL-derived stem + extension by detected format. */
export function filenameForResponse(
  url: string,
  contentType: string | undefined,
  body: string,
): string {
  const { format } = detectResponseFormat(contentType, body);
  return `${filenameFromUrl(url)}${EXTENSIONS[format]}`;
}

/** Trigger a file download of the given text (Bruno/Hoppscotch "save" behavior). */
export function downloadResponseText(text: string, filename: string, contentType?: string): void {
  const blob = new Blob([text], { type: contentType ?? "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

/** Decode base64 into a Uint8Array (binary-safe, chunked for large bodies). */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Extension for a raw MIME type (F1 media download). */
function extensionForMime(mime: string): string {
  const table: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/x-icon": ".ico",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "application/pdf": ".pdf",
  };
  if (table[mime]) return table[mime];
  if (mime.startsWith("image/")) return ".img";
  if (mime.startsWith("audio/")) return ".bin";
  if (mime.startsWith("video/")) return ".bin";
  return ".bin";
}

/** Trigger a download of a base64 binary body (F1 media). */
export function downloadResponseBase64(
  base64: string,
  url: string,
  contentType?: string,
): void {
  const mime = contentType?.split(";")[0].trim() ?? "application/octet-stream";
  const blob = new Blob([base64ToBytes(base64)], { type: mime });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${filenameFromUrl(url)}${extensionForMime(mime)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

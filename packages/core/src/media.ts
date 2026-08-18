/**
 * Media content-type detection for the response viewer (F1).
 *
 * A "media lens" (image / audio / video / PDF renderer) is offered when the
 * response content-type is one of these binary families. Everything else —
 * including application/octet-stream and font/* — is treated as an opaque
 * binary download (no renderer, download only).
 */

export type MediaKind = "image" | "audio" | "video" | "pdf";

/** Normalize a Content-Type header to its lowercased `type/subtype` form. */
export function normalizeContentType(contentType?: string): string {
  if (!contentType) return "";
  const idx = contentType.indexOf(";");
  return (idx >= 0 ? contentType.slice(0, idx) : contentType).trim().toLowerCase();
}

/** The renderable media kind for a Content-Type, or null when not a lens. */
export function mediaKind(contentType?: string): MediaKind | null {
  const ct = normalizeContentType(contentType);
  if (ct === "application/pdf") return "pdf";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("video/")) return "video";
  return null;
}

/** True for any binary content type that should be captured as bytes. */
export function isBinaryContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const ct = normalizeContentType(contentType);
  if (!ct) return false;
  return (
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    ct === "application/pdf" ||
    ct === "application/octet-stream" ||
    ct.startsWith("font/") ||
    ct.startsWith("application/zip") ||
    ct === "application/x-gzip" ||
    ct.startsWith("application/x-7z") ||
    ct === "application/x-tar"
  );
}

/** A media content type that the viewer can render via a lens. */
export function isMediaContentType(contentType?: string): boolean {
  return mediaKind(contentType) !== null;
}
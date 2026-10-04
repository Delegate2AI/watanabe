import path from "node:path";

/**
 * Content-Type for a KB asset served by `app/(app)/kb/assets/[...path]/route.ts`.
 *
 * The `/kb` view renders markdown notes as HTML, but a note can also reference
 * binary assets under `assets/` (diagrams, screenshots, PDFs). Those are served
 * as their real bytes with the type below, so the browser renders an image as
 * an image instead of feeding the bytes through the markdown renderer as
 * garbled text. Anything unrecognized falls back to `application/octet-stream`
 * (the browser downloads it, never executes it inline).
 */
const BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** Maps a vault-relative asset path to a Content-Type by extension. */
export function contentTypeForAsset(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  return BY_EXT[ext] ?? "application/octet-stream";
}

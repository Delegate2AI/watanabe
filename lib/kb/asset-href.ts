/**
 * The byte-serving URL for a KB binary asset (image, PDF, ...), by its
 * vault-relative path. Assets are served as their real bytes by
 * `app/api/kb/asset/[...path]/route.ts`, never rendered as markdown. The
 * `/kb/[[...slug]]` page uses this to redirect a direct non-`.md` URL to the
 * bytes, and the markdown renderer's `img` override uses it for the resolved
 * path of an embedded image (see `lib/kb/assets.ts`).
 */
const ASSET_BASE = "/api/kb/asset";

/** Builds the serving URL from a vault-relative path (POSIX, no leading slash). */
export function kbAssetHref(relPath: string): string {
  const encoded = relPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${ASSET_BASE}/${encoded}`;
}

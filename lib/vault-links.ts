/**
 * Rewrites a markdown link's `href`, as authored (Obsidian-relative, e.g.
 * `../02-market-and-research/dsr2-findings.md#some-heading`), to this app's
 * vault route (e.g. `/02-market-and-research/dsr2-findings#some-heading`).
 *
 * Used by `components/vault/vault-markdown.tsx` — the "working internal
 * links" requirement for the native KB view. Deliberately dependency-free
 * (no `node:path`) so it works identically in the server-rendered pass and in
 * the client bundle `VaultMarkdown` ships to the browser.
 *
 * Only rewrites links that plausibly point at another vault `.md` page.
 * Anything else — absolute URLs (`https://…`), `mailto:`/`tel:`, pure
 * same-page anchors (`#heading`), and relative links to non-`.md` targets
 * (images, `.canvas`, `.base`, …) — is returned unchanged: the web view only
 * ever renders `.md` pages, so a rewritten link to anything else would 404.
 */

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i; // "https:", "mailto:", "obsidian:", ...
const PROTOCOL_RELATIVE_RE = /^\/\//;

function splitHash(href: string): [path: string, hash: string] {
  const idx = href.indexOf("#");
  if (idx === -1) return [href, ""];
  return [href.slice(0, idx), href.slice(idx + 1)];
}

/**
 * Resolves `relPath`'s `.`/`..` segments against `baseDirSlug`, POSIX-style.
 *
 * `strict` decides what a climb above the vault root means. Rendering clamps it
 * (the result is an in-app route, and a clamped one 404s harmlessly), but a
 * rewriter must not: clamping would let an href pointing outside the vault
 * collide with a real file inside it and be rewritten as if it named that file.
 */
function resolveRelativeSegments(baseDirSlug: string[], relPath: string, strict = false): string[] | null {
  const stack = [...baseDirSlug];
  for (const part of relPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0 && strict) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack;
}

/**
 * The vault-relative path an href names, whatever its extension: images and
 * other attachments as well as notes. `kb_stage_move` needs this, because an
 * embed is a link and a moved PNG strands the same reference a moved note does.
 */
export function resolveVaultAssetPath(href: string, currentRelPath: string): string | null {
  if (!href || href.startsWith("#") || ABSOLUTE_URL_RE.test(href) || PROTOCOL_RELATIVE_RE.test(href)) {
    return null;
  }
  const [pathPart] = splitHash(href);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  const baseDir = decodedPath.startsWith("/") ? [] : currentRelPath.split("/").slice(0, -1);
  const cleanPath = decodedPath.startsWith("/") ? decodedPath.slice(1) : decodedPath;
  const segments = resolveRelativeSegments(baseDir, cleanPath, true);
  return segments && segments.length > 0 ? segments.join("/") : null;
}

/**
 * The same resolution restricted to notes: the web view and the backlink graph
 * are both `.md`-only surfaces, so a non-note target is not a target for them.
 */
export function resolveVaultTargetPath(href: string, currentRelPath: string): string | null {
  const [pathPart] = splitHash(href);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  if (!decodedPath.toLowerCase().endsWith(".md")) return null;
  return resolveVaultAssetPath(href, currentRelPath);
}

/**
 * @param href The link target exactly as written in the markdown source.
 * @param currentDirSlug The route slug of the DIRECTORY containing the
 *   current page (e.g. `["02-market-and-research"]` while rendering
 *   `02-market-and-research/dsr2-findings.md`; `[]` at the vault root).
 */
export function resolveVaultLink(href: string | undefined, currentDirSlug: string[]): string | undefined {
  if (!href) return href;
  if (href.startsWith("#")) return href;
  if (ABSOLUTE_URL_RE.test(href) || PROTOCOL_RELATIVE_RE.test(href)) return href;

  const [pathPart, hash] = splitHash(href);
  if (pathPart === "") return href;

  let decodedPath = pathPart;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    // Malformed percent-encoding — fall through with the raw path part.
  }

  if (!decodedPath.toLowerCase().endsWith(".md")) return href;

  // A leading "/" means "resolve from the vault root" (Obsidian supports
  // vault-absolute links), not from the current page's directory.
  const isVaultRootRelative = decodedPath.startsWith("/");
  const baseDir = isVaultRootRelative ? [] : currentDirSlug;
  const cleanPath = isVaultRootRelative ? decodedPath.slice(1) : decodedPath;

  const segments = resolveRelativeSegments(baseDir, cleanPath);
  if (!segments || segments.length === 0) return href;

  const last = segments[segments.length - 1].replace(/\.md$/i, "");
  const slugSegments = [...segments.slice(0, -1), last].filter(Boolean);
  const slugPath = slugSegments.map(encodeURIComponent).join("/");
  return `/${slugPath}${hash ? `#${hash}` : ""}`;
}

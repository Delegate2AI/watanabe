import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  proseRehypePlugins,
  proseRemarkPlugins,
  proseSharedComponents,
  proseSkipHtml,
} from "@/lib/markdown/shared";
import { resolveVaultLink } from "@/lib/vault-links";
import { kbDocHref } from "./doc-path";
import { kbAssetHref } from "./asset-href";
import type { KbAssetResolver } from "./assets";
import { dropTitleHeading } from "./snippet";
import { rewriteWikilinks, type WikilinkResolver } from "./wikilinks";

/**
 * Server-side markdown renderer for the clearance-scoped KB view (spec 25).
 *
 * Security: `react-markdown` does NOT pass raw HTML through unless `rehype-raw`
 * is added (we deliberately do not add it). So any `<script>` or
 * `<img onerror=...>` embedded in note content is never executed, and with
 * `skipHtml` (see lib/markdown/shared.tsx) it is not printed as text either. Its
 * built-in `defaultUrlTransform` also strips dangerous URL schemes
 * (`javascript:`, `data:`, ...). This is the strict sanitizer allowlist the spec
 * asks for; no extra dependency is needed.
 *
 * Links: an internal `.md` link (as authored in the vault, Obsidian-relative) is
 * rewritten to this app's `/kb/<route>` URL via `resolveVaultLink`. External
 * links, mailto/tel, and same-page anchors pass through untouched.
 */

const KB_BASE = "/kb";

export interface RenderMarkdownOptions {
  /**
   * The note's title. When the body opens with an H1 that repeats it, that
   * heading is dropped: the page header already renders the title, and printing
   * it twice is the note looking like it stutters.
   */
  title?: string;
  /** Route slug of the directory containing the current note (for relative link resolution). */
  currentDirSlug?: string[];
  /** Vault-relative path of the current note (for wikilink relative resolution). */
  currentRelPath?: string;
  /** Resolves a `[[wikilink]]` target to a route-ready rel path (no `.md`), or null when absent. */
  resolveWikilink?: WikilinkResolver;
  /** Resolves an authored image `src` to a vault-relative asset path, or null when absent. */
  resolveAsset?: KbAssetResolver;
}

/** Rewrite an authored href to the app URL. Internal `.md` links get the `/kb` prefix. */
function toAppHref(href: string | undefined, currentDirSlug: string[]): string | undefined {
  if (!href) return href;
  // Wikilinks are pre-rewritten to absolute `/kb/...` routes; leave them as-is.
  if (href.startsWith(`${KB_BASE}/`) || href === KB_BASE) return href;
  const resolved = resolveVaultLink(href, currentDirSlug);
  // `resolveVaultLink` only changes internal `.md` links; those come back as a
  // leading-slash route. Prefix `/kb`; everything else passes through unchanged.
  if (resolved && resolved !== href && resolved.startsWith("/")) {
    return `${KB_BASE}${resolved}`;
  }
  return resolved;
}

/** The citation-path styling for a doc-path token, as a link or (already inside a link) a plain span. */
function renderCitation(text: string, href: string, asLink: boolean) {
  return asLink ? (
    <a href={href} className="citation-path" title={`Open ${text}`}>
      {text}
    </a>
  ) : (
    <span className="citation-path" title={`Open ${text}`}>
      {text}
    </span>
  );
}

/**
 * A citation-path code span (see `CodeSpan` below) normally renders as an
 * `<a>`. When it is the sole content of an authored markdown link (e.g.
 * `` [`INDEX.md`](INDEX.md) ``), nesting an `<a>` inside another `<a>` is
 * invalid HTML and triggers a React hydration error, so `Anchor` recognizes
 * that pattern and renders the citation styling itself as a `<span>`, never
 * invoking `CodeSpan` for that child: the outer link already makes the whole
 * thing clickable.
 *
 * This can't be done via a "was I rendered inside a link" React Context:
 * `Components.code` overrides render inside a Server Component tree (spec
 * 25), and `createContext`/`useContext` are Client-Component-only APIs in the
 * Next.js App Router. react-markdown's nested custom components are also
 * still-unresolved element references at the point `Anchor` runs (`CodeSpan`
 * itself hasn't been called yet), so `Anchor` can't inspect their rendered
 * output either. It has to recognize the pattern by comparing
 * `child.type === CodeSpan` directly, a plain function-reference check that
 * needs no hooks.
 */
function rewriteCitationChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== CodeSpan) return child;
    const props = child.props as { className?: string; children?: ReactNode };
    if (props.className) return child; // block code, never a citation candidate
    const text = String(props.children).trim();
    const href = kbDocHref(text);
    return href ? renderCitation(text, href, false) : child;
  });
}

/** Rewrites an authored markdown link to the app URL. */
function Anchor(
  { href, title, children }: { href?: string; title?: string; children?: ReactNode },
  currentDirSlug: string[],
) {
  const appHref = toAppHref(href, currentDirSlug);
  return (
    <a href={appHref} title={title}>
      {rewriteCitationChildren(children)}
    </a>
  );
}

// An inline code span that names a KB document (e.g.
// `00-overview/executive-summary.md`) becomes a link to that doc's `/kb`
// route, so the many index/map notes that cite paths in backticks are
// navigable. Block code (```) carries a `className` and is left untouched.
// Linking is optimistic and clearance-safe: a restricted/missing target
// 404s on click, exactly like the page (see kbDocHref).
function CodeSpan({ className, children }: { className?: string; children?: ReactNode }) {
  const text = String(children).trim();
  const href = className ? null : kbDocHref(text);
  if (href) return renderCitation(text, href, true);
  return <code className={className}>{children}</code>;
}

/**
 * Rewrites a markdown image `![alt](src)` so the authored src (a bare filename
 * or relative path, Obsidian-style) resolves via `resolveAsset` to the real
 * vault asset, then points at the byte route (`kbAssetHref`). An src that does
 * not resolve, or an absolute/external/`data:` src, is left as authored. A plain
 * `<img>` is intentional: vault asset paths are arbitrary and served by our own
 * route, so `next/image`'s static optimization does not apply.
 */
function Img(
  { src, alt, title }: { src?: string; alt?: string; title?: string },
  currentDirSlug: string[],
  resolveAsset?: KbAssetResolver,
) {
  // Resolve the authored src (a bare filename or relative path) to a real vault
  // asset and point at the byte route; when it does not resolve (or no resolver
  // is supplied), leave the src as authored.
  const rel = resolveAsset?.(src, currentDirSlug) ?? null;
  const finalSrc = rel ? kbAssetHref(rel) : src;
  // eslint-disable-next-line @next/next/no-img-element -- dynamic vault asset path, not a static import
  return <img src={finalSrc} alt={alt ?? ""} title={title} />;
}

function markdownComponents(currentDirSlug: string[], resolveAsset?: KbAssetResolver): Components {
  return {
    ...proseSharedComponents,
    a: (props) => Anchor(props, currentDirSlug),
    code: CodeSpan,
    img: ({ src, alt, title }) =>
      Img({ src: typeof src === "string" ? src : undefined, alt, title }, currentDirSlug, resolveAsset),
  };
}

export function renderMarkdown(body: string, options: RenderMarkdownOptions = {}): ReactElement {
  const source = dropTitleHeading(body, options.title);
  const prepared = options.resolveWikilink
    ? rewriteWikilinks(source, {
        currentRelPath: options.currentRelPath ?? "",
        resolve: options.resolveWikilink,
        // The same resolver `Img` uses below, so `![[Diagram.png]]` and
        // `![](Diagram.png)` land on the same bytes; here it also decides
        // whether an embed becomes an image or inert text.
        resolveAsset: options.resolveAsset,
      })
    : source;

  return (
    <ReactMarkdown
      remarkPlugins={proseRemarkPlugins}
      rehypePlugins={proseRehypePlugins}
      components={markdownComponents(options.currentDirSlug ?? [], options.resolveAsset)}
      skipHtml={proseSkipHtml}
    >
      {prepared}
    </ReactMarkdown>
  );
}

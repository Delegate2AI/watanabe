import { kbAssetHref } from "./asset-href";
import type { KbAssetResolver } from "./assets";

/**
 * Wikilink rewriting for the clearance-scoped KB view (spec 25).
 *
 * `[[Note Title]]`, `[[path/to/note]]`, `[[note|Alias]]`, and `[[note#Heading]]`
 * are Obsidian-style links. They are not standard markdown, so we rewrite them
 * to standard markdown links BEFORE handing the body to the markdown renderer.
 *
 * `![[...]]` is an Obsidian EMBED, and the leading `!` is part of the syntax:
 * matching only `[[...]]` left that `!` on the output, which turned a note embed
 * into an `<img>` pointing at an HTML route and an asset embed into the literal
 * text `!Diagram.png`. An asset embed now inlines the image; a note embed
 * degrades to an ordinary wikilink (transclusion is a non-goal, see the
 * "Obsidian markup fidelity" spec).
 *
 * Absence is the boundary (spec 19): the `resolve` and `resolveAsset` callbacks
 * consult the per-projection indexes. A target that is not in the requester's
 * projection resolves to `null` and is rendered as INERT TEXT (its label), never
 * a dead link or a broken-image placeholder that would hint the target exists.
 */

const WIKI_LINK = /(!?)\[\[([^\]]+)\]\]/g;
const KB_BASE = "/kb";

/**
 * Resolve a wikilink target (a title or a vault path, as authored) to a
 * route-ready rel path (POSIX, no leading slash, no `.md`), or `null` when the
 * target is not in the projection.
 */
export type WikilinkResolver = (target: string) => string | null;

export interface RewriteWikilinksOptions {
  /** Vault-relative path of the note being rendered; its directory scopes `resolveAsset`. */
  currentRelPath?: string;
  resolve: WikilinkResolver;
  /**
   * Resolves an embedded asset target to a vault-relative path, or `null`.
   * Resolving here rather than leaving the authored target for the renderer's
   * `img` override is deliberate: it is what lets an unresolvable embed become
   * inert text instead of a broken `<img>`. A placeholder is a presence, and
   * absence is the boundary.
   */
  resolveAsset?: KbAssetResolver;
}

/** Split `target|Alias` into `[target, alias?]`. */
function splitAlias(inner: string): [string, string | undefined] {
  const idx = inner.indexOf("|");
  if (idx === -1) return [inner, undefined];
  return [inner.slice(0, idx), inner.slice(idx + 1)];
}

/** Split `target#Heading` into `[target, heading?]`. */
function splitHeading(target: string): [string, string | undefined] {
  const idx = target.indexOf("#");
  if (idx === -1) return [target, undefined];
  return [target.slice(0, idx), target.slice(idx + 1)];
}

/** Obsidian-style heading anchor: lowercased, spaces to dashes. */
function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

/** Escape markdown link-label characters so an alias cannot re-open a link. */
function escapeLabel(label: string): string {
  return label.replace(/([[\]])/g, "\\$1");
}

/**
 * The markdown link for a resolved note. Each route segment is percent-encoded,
 * so a target containing spaces cannot emit a destination that truncates at the
 * first one.
 */
function noteLink(label: string, route: string, heading?: string): string {
  const hash = heading ? `#${headingAnchor(heading)}` : "";
  const routeSegments = route.split("/").map(encodeURIComponent).join("/");
  return `[${escapeLabel(label)}](${KB_BASE}/${routeSegments}${hash})`;
}

/** The directory of the note being rendered, as the slug `resolveAsset` expects. */
function dirSlugOf(relPath: string | undefined): string[] {
  return (relPath ?? "").split("/").filter(Boolean).slice(0, -1);
}

interface Parsed {
  target: string;
  heading?: string;
  /** The `|` part: an alias in a link, a display-size hint in an embed. */
  pipe?: string;
}

function parse(inner: string): Parsed {
  const [linkPart, pipe] = splitAlias(inner.trim());
  const [rawTarget, heading] = splitHeading(linkPart.trim());
  return { target: rawTarget.trim(), heading, pipe };
}

/**
 * `![[target]]`. An asset inlines as an image; a note degrades to an ordinary
 * wikilink rather than transcluding its body.
 *
 * Note resolution is tried first, then asset. The two indexes are disjoint by
 * construction (`listKbFiles` walks `.md` only, `walkAssets` skips every `.md`),
 * so the order is not arbitrating an ambiguity, it just has to pick one.
 *
 * The `|` part is a display-size specifier here (`![[img.png|300]]`), not an
 * alias, so it is parsed off and discarded. Sizing is not implemented.
 */
function rewriteEmbed(inner: string, options: RewriteWikilinksOptions, whole: string): string {
  const { target, heading } = parse(inner);
  if (target === "") return whole;

  const route = options.resolve(target);
  if (route) return noteLink(target, route, heading);

  const rel = options.resolveAsset?.(target, dirSlugOf(options.currentRelPath)) ?? null;
  // `kbAssetHref` percent-encodes each segment, so `![[My Diagram.png]]` emits
  // `/api/kb/asset/My%20Diagram.png` and the space survives in the alt text only.
  if (rel) return `![${escapeLabel(target)}](${kbAssetHref(rel)})`;

  // Neither index knows it: inert text, and the `!` goes with it.
  return target;
}

/** `[[target]]`, unchanged behaviour: a link when resolvable, inert text when not. */
function rewriteLink(inner: string, options: RewriteWikilinksOptions, whole: string): string {
  const { target, heading, pipe } = parse(inner);
  // No alias: label is the target as authored, minus any heading fragment.
  const label = (pipe ?? target).trim();

  if (target === "") return whole;

  const route = options.resolve(target);
  // Absent from the projection: inert text, no link, no leak.
  return route ? noteLink(label, route, heading) : label;
}

export function rewriteWikilinks(body: string, options: RewriteWikilinksOptions): string {
  return body.replace(WIKI_LINK, (whole, bang: string, inner: string) =>
    bang === "!" ? rewriteEmbed(inner, options, whole) : rewriteLink(inner, options, whole),
  );
}

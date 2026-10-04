import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveVaultAssetPath } from "@/lib/vault-links";
import { resolveWritableInRoot } from "./paths";

/**
 * Plan a move, links included (spec 2026-08-21-admin-kb-mcp, D6).
 *
 * A move expressed as an edit plus a delete breaks every inbound link silently:
 * the only submit-time checks are advisory reviewers, not a link walker. So the
 * rename and the rewrites are one plan, and `kb_diff` shows both before anything
 * is submitted.
 *
 * Pure over a root, with no git and no worktree, so it is testable directly.
 */

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const WIKI_LINK = /\[\[([^\]|#]+)((?:#[^\]|]+)?)((?:\|[^\]]+)?)\]\]/g;
/** A fenced block or a run of inline code. Both are examples, not links. */
const CODE_SPAN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

export interface MovePlan {
  /** The single rename to perform: the file, or the directory as a whole. */
  directory: { from: string; to: string };
  /** Every file that moves, assets included, for the link mapping. */
  renames: { from: string; to: string }[];
  rewrites: { path: string; content: string }[];
}

export type MoveResult = MovePlan | { error: string };

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

/**
 * Every file under `root`, or only the notes. Assets need the full list: a
 * moved PNG is a moved link target, and only the notes need reading for links.
 */
function vaultFiles(root: string, notesOnly: boolean, dir: string = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    // Never follow a link out of the tree we are walking.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...vaultFiles(root, notesOnly, absolute));
    else if (entry.isFile() && (!notesOnly || entry.name.toLowerCase().endsWith(".md"))) {
      files.push(toPosix(path.relative(root, absolute)));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Containment, the ignore list, the system-owned list and symlink resolution,
 * all through the one check every other write tool uses. Returns the path
 * relative to the root, or the refusal text.
 */
function checked(root: string, rel: string): { rel: string } | { error: string } {
  const resolved = resolveWritableInRoot(rel, root);
  if (!resolved.ok) {
    const first = resolved.result.content[0];
    return { error: first && "text" in first ? String(first.text) : `"${rel}" cannot be written.` };
  }
  return { rel: toPosix(path.relative(root, resolved.abs)) };
}

/**
 * The characters that end a markdown destination early if written raw. The path
 * comes back from `path.relative` decoded, so a name with a space in it would
 * otherwise emit a link that stops at the space.
 */
function encodeHref(rel: string): string {
  return rel
    .split("/")
    // "." and ".." survive encodeURIComponent unchanged, so the relative
    // prefix is preserved. Parentheses do too, and a raw ")" ends the
    // destination early, so they are escaped after it.
    .map((segment) => encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29"))
    .join("/");
}

/** The href a link should carry after the move, or `null` to leave it alone. */
function rewrittenHref(href: string, sourceOld: string, sourceNew: string, moved: Map<string, string>): string | null {
  const target = resolveVaultAssetPath(href, sourceOld);
  if (!target) return null;
  const next = moved.get(target) ?? target;
  // A link inside a file that is itself moving needs rewriting even when its
  // target stays put: the same relative path now starts from somewhere else.
  if (next === target && sourceOld === sourceNew) return null;
  if (href.startsWith("/")) return `/${encodeHref(next)}`;
  const rel = toPosix(path.relative(path.dirname(sourceNew), next));
  return encodeHref(rel.startsWith(".") ? rel : `./${rel}`);
}

/** Split a markdown destination into its path and everything after it. */
function splitDestination(raw: string): { href: string; suffix: string } {
  const match = /^(\S+)(\s[\s\S]*)?$/.exec(raw.trim());
  return match ? { href: match[1], suffix: match[2] ?? "" } : { href: raw.trim(), suffix: "" };
}

/**
 * The hrefs a wikilink body might name, most specific first.
 *
 * A wikilink may omit the extension ("[[a/one]]"), carry it ("[[a/one.md]]"),
 * or name an asset ("![[chart.png]]"). A path with a slash in it is read from
 * the vault root; a bare name may also be a sibling of the note it sits in,
 * which is how an image embed is usually written. `strip` says whether the
 * ".md" was ours to add, and so whether to take it back off.
 */
function wikilinkCandidates(body: string, byBasename: Map<string, string[]>): { href: string; strip: boolean }[] {
  const rooted = body.startsWith("/") ? body : `/${body}`;
  const named: [string, boolean][] = [[body, false], [`${body}.md`, true]];
  if (body.includes("/")) {
    return [{ href: rooted, strip: false }, { href: `${rooted}.md`, strip: true }];
  }

  // A bare name is a filename, not a path, and Obsidian looks it up across the
  // whole vault. Two files answering to it make the link ambiguous: leave it
  // alone rather than guess, and do that BEFORE the root and sibling
  // candidates, which would otherwise pick one of the two by position.
  if (named.some(([name]) => (byBasename.get(name.toLowerCase())?.length ?? 0) > 1)) return [];

  const out = [
    { href: rooted, strip: false },
    { href: `${rooted}.md`, strip: true },
    { href: body, strip: false },
    { href: `${body}.md`, strip: true },
  ];
  for (const [name, strip] of named) {
    const matches = byBasename.get(name.toLowerCase());
    if (matches?.length === 1) out.push({ href: `/${matches[0]}`, strip });
  }
  return out;
}

function rewriteSegment(
  text: string,
  sourceOld: string,
  sourceNew: string,
  moved: Map<string, string>,
  byBasename: Map<string, string[]>,
): string {
  const withMarkdown = text.replace(MARKDOWN_LINK, (whole, rawDestination: string) => {
    const { href, suffix } = splitDestination(rawDestination);
    const [pathPart, ...hash] = href.split("#");
    const next = rewrittenHref(pathPart, sourceOld, sourceNew, moved);
    if (!next) return whole;
    const fragment = hash.length > 0 ? `#${hash.join("#")}` : "";
    return whole.replace(rawDestination, `${next}${fragment}${suffix}`);
  });

  return withMarkdown.replace(WIKI_LINK, (whole, body: string, heading: string, alias: string) => {
    const trimmed = body.trim();
    for (const { href, strip } of wikilinkCandidates(trimmed, byBasename)) {
      const target = resolveVaultAssetPath(href, sourceOld);
      const next = target ? moved.get(target) : undefined;
      if (!next) continue;
      return `[[${strip ? next.replace(/\.md$/i, "") : next}${heading}${alias}]]`;
    }
    return whole;
  });
}

/** Rewrite links outside code only. Inside a fence or backticks it is prose. */
function rewriteBody(
  body: string,
  sourceOld: string,
  sourceNew: string,
  moved: Map<string, string>,
  byBasename: Map<string, string[]>,
): string {
  return body
    .split(CODE_SPAN)
    .map((segment, index) =>
      index % 2 === 1 ? segment : rewriteSegment(segment, sourceOld, sourceNew, moved, byBasename))
    .join("");
}

export function planMove(root: string, from: string, to: string): MoveResult {
  const source = checked(root, from);
  if ("error" in source) return { error: source.error };
  const destination = checked(root, to);
  if ("error" in destination) return { error: destination.error };
  // Checked AFTER resolution, not on the raw argument: ".", "./" and "a/.."
  // all name the vault root, which has no name to move and no parent to move
  // into.
  if (source.rel === "" || destination.rel === "") {
    return { error: "That would move the whole knowledge base. Name a file or a folder inside it." };
  }
  if (source.rel === destination.rel) return { error: "The source and destination are the same path." };
  if (destination.rel.startsWith(`${source.rel}/`)) {
    return { error: `"${to}" is inside "${from}", so the move has nowhere to land.` };
  }

  try {
    statSync(/* turbopackIgnore: true */ path.join(root, destination.rel));
    return { error: `"${to}" already exists. Move it aside first, or pick another destination.` };
  } catch {
    // The normal case: nothing is there yet.
  }

  let stat;
  try {
    stat = statSync(/* turbopackIgnore: true */ path.join(root, source.rel));
  } catch {
    return { error: `No such path in the knowledge base: "${from}".` };
  }

  // One rename either way. `renames` is the link mapping, so it covers assets
  // as well as notes: an embed pointing at a moved PNG dangles exactly as a
  // link to a moved note does.
  const renames = stat.isFile()
    ? [{ from: source.rel, to: destination.rel }]
    : vaultFiles(path.join(root, source.rel), false).map((file) => ({
        from: `${source.rel}/${file}`,
        to: `${destination.rel}/${file}`,
      }));

  const moved = new Map(renames.map((r) => [r.from, r.to]));
  // A bare wikilink names a file, not a path, so resolving one needs the whole
  // vault indexed by basename. Built from the pre-move paths, which is what the
  // links being read still say.
  const byBasename = new Map<string, string[]>();
  for (const file of vaultFiles(root, false)) {
    const key = path.posix.basename(file).toLowerCase();
    byBasename.set(key, [...(byBasename.get(key) ?? []), file]);
  }

  const rewrites: { path: string; content: string }[] = [];
  for (const file of vaultFiles(root, true)) {
    const body = readFileSync(/* turbopackIgnore: true */ path.join(root, file), "utf8");
    // Keyed by the file's NEW path when it is itself moving, so a rewrite never
    // lands in a file this same plan is about to remove.
    const at = moved.get(file) ?? file;
    const next = rewriteBody(body, file, at, moved, byBasename);
    if (next !== body) rewrites.push({ path: at, content: next });
  }
  return { directory: { from: source.rel, to: destination.rel }, renames, rewrites };
}

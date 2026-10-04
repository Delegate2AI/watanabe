import path from "node:path";
import { stringify } from "yaml";
import { splitBody } from "@/lib/kb/note";

/**
 * Build the published KB note for an artifact (spec 27): a frontmatter header
 * carrying `visibility = target_visibility` (enforced downstream by spec 19/25)
 * plus `title` and `type: note`, followed by the artifact body. Any frontmatter
 * the chat-authored body already carried is stripped first (`splitBody`) so the
 * note never ends up with two frontmatter blocks.
 */
export function buildPublishedNote(p: { title: string; visibility: string[]; body: string }): string {
  const header = stringify({ title: p.title, type: "note", visibility: p.visibility }).trimEnd();
  const body = splitBody(p.body.replace(/^﻿/, "")).replace(/^\n+/, "").trimEnd();
  return `---\n${header}\n---\n\n${body}\n`;
}

/**
 * Turn an artifact's `target_path` into a vault-relative candidate WITHOUT
 * doing containment itself: containment and the ignore-list are the write
 * path's single authority (`resolveInRoot`, see `lib/kb-mcp/tools.ts`), which
 * the publish bridge routes through next. This function only does the two
 * checks that must happen BEFORE normalization, plus stripping the `docs/`
 * prefix (the vault root already IS `docs/`):
 *
 *  - reject an ABSOLUTE path outright (never silently strip a leading `/` and
 *    turn it into a relative path, which is how an escape sneaks in);
 *  - reject a NON-markdown target (v1 artifacts are markdown documents).
 *
 * Returns the vault-relative path, or an error string the caller surfaces as a
 * 400. It deliberately does NOT try to detect `..` traversal or ignored areas:
 * `resolveInRoot` is the authority for both, so re-implementing them here would
 * be a second, weaker copy.
 */
export function normalizeTargetInput(targetPath: string): { ok: true; rel: string } | { ok: false; error: string } {
  const trimmed = targetPath.trim();
  if (trimmed === "") return { ok: false, error: "target path is empty" };
  if (path.isAbsolute(trimmed)) return { ok: false, error: "target path must be a relative docs/ path" };
  if (path.extname(trimmed).toLowerCase() !== ".md") {
    return { ok: false, error: "target path must be a markdown (.md) file" };
  }
  const rel = trimmed.replace(/^docs\//, "");
  if (rel.trim() === "") return { ok: false, error: "target path is empty" };
  return { ok: true, rel };
}

/** `Risk Disclosure!` -> `risk-disclosure`, a safe branch slug for `submit`. */
export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

import { readVaultFile, resolveVaultEntry } from "@/lib/vault";
import { MAX_SELECTION_BYTES, type DocSelection, type MessageContext } from "./context";
import { capText } from "./context-render";
import { normalizeForComparison, relocate } from "./context-normalize";
import { resolveSharedDocSelection } from "./context-resolve-shared-doc";

// Rendering + total-byte capping of the `<portal-context>` block lives in
// ./context-render.ts (this module owns the vault-side RESOLUTION). Re-exported
// here so existing importers (the route, transcript/context-block tests) keep
// their `from "./context-resolve"` import path unchanged.
export { renderContextBlock, type AttachmentContext } from "./context-render";

/**
 * Server-side resolution of a client-proposed selection (spec 11 D18): the
 * client sends coordinates (path, line range, selected text); this module
 * re-reads the real vault file and treats the client's copy as unverified
 * input, never as the content that reaches the model.
 *
 * Containment is enforced by reusing `resolveVaultEntry` (which itself
 * reuses `isPathWithinVault` from `lib/agent/permissions.ts`) — this module
 * must never write a second containment check. `resolveVaultEntry` already
 * conflates "escaped the vault" with "doesn't exist" into one `null` return
 * (by its own doc comment); re-deriving that distinction here would require
 * exactly the second check we're avoiding, so both surface as one generic
 * `containment` error.
 */

export interface ResolvedContext {
  path: string;
  headingTrail: string[];
  startLine: number;
  endLine: number;
  excerpt: string;
  enclosingSection: string;
  truncated: boolean;
  provenance: "verified" | "relocated" | "client";
  docTitle: string;
}

export type ContextResolutionError = { kind: "containment"; path: string };

export type ContextResolutionResult =
  | { ok: true; resolved: ResolvedContext }
  | { ok: false; error: ContextResolutionError };

// Normalization + relocation helpers live in ./context-normalize.ts, shared
// with the shared-doc resolver so neither module imports the other's runtime.

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Heading trail + enclosing section, computed from raw file text via a plain
 * line-scan regex — no markdown AST/`unified` dependency needed for this
 * (only `^#{1,6}\s` matters, not full markdown parsing). 1-based line
 * numbers throughout, matching `startLine`/`endLine`'s own convention.
 */
function computeHeadingContext(
  lines: string[],
  startLine: number,
): { headingTrail: string[]; sectionStartLine: number; sectionEndLine: number } {
  const stack: string[] = [];
  let sectionStartLine = 1;
  let sectionStartLevel = 0;

  for (let i = 0; i < startLine - 1 && i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    stack.length = level - 1;
    stack[level - 1] = m[2].trim();
    sectionStartLine = i + 1;
    sectionStartLevel = level;
  }

  let sectionEndLine = lines.length;
  for (let i = sectionStartLine; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m && (sectionStartLevel === 0 || m[1].length <= sectionStartLevel)) {
      sectionEndLine = i; // 1-based line just before this heading (lines[i] is 0-based, 1-based line i+1)
      break;
    }
  }

  return { headingTrail: stack.filter(Boolean), sectionStartLine, sectionEndLine };
}

/** Dispatch on the chip's member type; each member has its own resolver. */
export function resolveMessageContext(ctx: MessageContext): ContextResolutionResult {
  switch (ctx.type) {
    case "shared-doc-selection":
      return resolveSharedDocSelection(ctx);
    case "doc-selection":
      return resolveDocSelection(ctx);
  }
}

function resolveDocSelection(ctx: DocSelection): ContextResolutionResult {
  const segments = ctx.path.split("/");
  const entry = resolveVaultEntry(segments);
  if (!entry || entry.isDirectory) {
    return { ok: false, error: { kind: "containment", path: ctx.path } };
  }

  const content = readVaultFile(entry.relPath);
  const normalizedSelected = normalizeForComparison(ctx.selectedText);

  if (content === null) {
    // The vault file existed a moment ago (resolveVaultEntry succeeded) but a
    // read race means it's gone now — degrade, don't 500 the whole turn.
    return { ok: true, resolved: clientFallback(ctx, entry.relPath) };
  }

  const lines = content.split("\n");
  const inBounds = ctx.startLine >= 1 && ctx.endLine <= lines.length;
  const rawExtract = inBounds ? lines.slice(ctx.startLine - 1, ctx.endLine).join("\n") : null;

  let startLine = ctx.startLine;
  let endLine = ctx.endLine;
  let provenance: ResolvedContext["provenance"];

  if (rawExtract !== null && normalizeForComparison(rawExtract) === normalizedSelected) {
    provenance = "verified";
  } else {
    const found = relocate(lines, normalizedSelected);
    if (found) {
      startLine = found.startLine;
      endLine = found.endLine;
      provenance = "relocated";
    } else {
      return { ok: true, resolved: clientFallback(ctx, entry.relPath) };
    }
  }

  const excerptRaw = lines.slice(startLine - 1, endLine).join("\n");
  const { headingTrail, sectionStartLine, sectionEndLine } = computeHeadingContext(lines, startLine);
  const enclosingSectionRaw = lines.slice(sectionStartLine - 1, sectionEndLine).join("\n");

  const excerptCapped = capText(excerptRaw, MAX_SELECTION_BYTES);
  const sectionCapped = capText(enclosingSectionRaw, MAX_SELECTION_BYTES);

  return {
    ok: true,
    resolved: {
      path: entry.relPath,
      headingTrail,
      startLine,
      endLine,
      excerpt: excerptCapped.text,
      enclosingSection: sectionCapped.text,
      truncated: excerptCapped.truncated || sectionCapped.truncated,
      provenance,
      docTitle: ctx.docTitle,
    },
  };
}

/** The one path where unverified client-supplied content flows through — clearly labeled, never silently trusted. */
function clientFallback(ctx: DocSelection, resolvedPath: string): ResolvedContext {
  const capped = capText(ctx.selectedText, MAX_SELECTION_BYTES);
  return {
    path: resolvedPath,
    headingTrail: ctx.headingTrail,
    startLine: ctx.startLine,
    endLine: ctx.endLine,
    excerpt: capped.text,
    enclosingSection: capped.text,
    truncated: capped.truncated,
    provenance: "client",
    docTitle: ctx.docTitle,
  };
}

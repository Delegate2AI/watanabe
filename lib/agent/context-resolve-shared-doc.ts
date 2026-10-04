import { getDb } from "@/lib/db/client";
import { latestBody } from "@/lib/db/shared-docs";
import { MAX_SELECTION_BYTES, type SharedDocSelection } from "./context";
import { capText } from "./context-render";
import { normalizeForComparison, relocate } from "./context-normalize";
// Type-only, so the mutual reference with ./context-resolve is erased at runtime.
import type { ContextResolutionResult, ResolvedContext } from "./context-resolve";

/**
 * Server-side resolution of a shared-doc selection chip (spec 2026-08-27),
 * the sibling of `./context-resolve.ts`'s vault resolver: the client's quote
 * is unverified input, re-located in the doc's latest markdown source.
 *
 * ACL note: this resolver reads the doc body, so the ROUTE must have already
 * proven comment access via the request's own `docId` (it rejects a chip
 * whose id differs from the bound doc before resolving). Returns the shared
 * `ResolvedContext` shape verbatim, `path: "shared-doc:<id>"` and lines 1/1
 * when unknown, so `./context-render.ts` needs no changes.
 */
export function resolveSharedDocSelection(ctx: SharedDocSelection): ContextResolutionResult {
  const body = latestBody(getDb(), ctx.docId) ?? "";
  const path = `shared-doc:${ctx.docId}`;

  const exactAt = body.indexOf(ctx.quote);
  if (exactAt >= 0) {
    const upTo = body.slice(0, exactAt).split("\n").length;
    return resolved(ctx, path, ctx.quote, upTo, upTo + ctx.quote.split("\n").length - 1, "verified");
  }

  const lines = body.split("\n");
  const found = relocate(lines, normalizeForComparison(ctx.quote));
  if (found) {
    const excerpt = lines.slice(found.startLine - 1, found.endLine).join("\n");
    return resolved(ctx, path, excerpt, found.startLine, found.endLine, "relocated");
  }

  // The one path where unverified client-supplied content flows through,
  // clearly labeled, same as the vault resolver's fallback.
  return resolved(ctx, path, ctx.quote, 1, 1, "client");
}

function resolved(
  ctx: SharedDocSelection,
  path: string,
  excerptRaw: string,
  startLine: number,
  endLine: number,
  provenance: ResolvedContext["provenance"],
): ContextResolutionResult {
  const capped = capText(excerptRaw, MAX_SELECTION_BYTES);
  return {
    ok: true,
    resolved: {
      path,
      headingTrail: [],
      startLine,
      endLine,
      excerpt: capped.text,
      enclosingSection: capped.text,
      truncated: capped.truncated,
      provenance,
      docTitle: ctx.docTitle,
    },
  };
}

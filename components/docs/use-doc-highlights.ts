"use client";

import { useEffect, type RefObject } from "react";
import type { TextAnchor } from "@/lib/shared-docs/types";
import { plainTextOf, rangeFromOffsets } from "@/lib/shared-docs/rendered-text";
import { resolveAnchor } from "@/lib/shared-docs/anchor";

export interface HighlightItem {
  id: string;
  anchor: TextAnchor | null;
  kind: "comment" | "suggestion";
}

/**
 * Register comment/suggestion ranges with the CSS Custom Highlight API so the
 * rendered body is never mutated (safe across React re-renders). Anchors that no
 * longer resolve are skipped (they surface in the margin's orphaned section).
 * A browser without `Highlight` simply shows no highlight (graceful).
 */
export function useDocHighlights(rootRef: RefObject<HTMLElement | null>, items: HighlightItem[]): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof Highlight === "undefined" || !CSS.highlights) return;
    const text = plainTextOf(root);
    const comment = new Highlight();
    const suggestion = new Highlight();
    for (const item of items) {
      if (!item.anchor) continue;
      const at = resolveAnchor(text, item.anchor);
      if (!at) continue;
      const range = rangeFromOffsets(root, at.start, at.end);
      if (!range) continue;
      (item.kind === "comment" ? comment : suggestion).add(range);
    }
    CSS.highlights.set("doc-comment", comment);
    CSS.highlights.set("doc-suggestion", suggestion);
    return () => {
      CSS.highlights.delete("doc-comment");
      CSS.highlights.delete("doc-suggestion");
    };
  }, [rootRef, items]);
}

"use client";

import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DocMode = "suggest" | "view" | "edit";

/**
 * The document mode control (redesign 2026-07-22): a segmented Suggesting /
 * Viewing / Editing switch plus the "Add comment" affordance, replacing the old
 * preview checkbox + "Edit document" chip row. Purely presentational: it maps
 * clicks to the existing preview/edit state the caller owns, so behaviour is
 * unchanged. Segments the caller's access does not permit are never rendered;
 * when only one mode is available the control degrades to a static label.
 */
export function DocToolbar({
  mode,
  canComment,
  canEdit,
  onMode,
  onAddComment,
}: {
  mode: DocMode;
  canComment: boolean;
  canEdit: boolean;
  onMode: (mode: DocMode) => void;
  onAddComment: () => void;
}) {
  const modes: { id: DocMode; label: string; show: boolean }[] = [
    { id: "suggest", label: "Suggesting", show: canComment },
    { id: "view", label: "Viewing", show: true },
    { id: "edit", label: "Editing", show: canEdit },
  ];
  const visible = modes.filter((m) => m.show);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {visible.length > 1 ? (
        <div
          role="tablist"
          aria-label="Document mode"
          className="inline-flex items-center gap-0.5 rounded-control border border-line bg-surface-2 p-0.5"
        >
          {visible.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onMode(m.id)}
                className={cn(
                  "rounded-tab px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-surface text-ink shadow-card"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="text-xs font-medium text-ink-muted">Viewing</span>
      )}

      {canComment && mode === "suggest" && (
        <Button variant="outline" size="sm" onClick={onAddComment} className="gap-1.5">
          <MessageSquarePlus className="size-4" aria-hidden />
          Add comment
        </Button>
      )}
    </div>
  );
}

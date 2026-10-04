"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import type { ArtifactVersion } from "@/lib/db/artifacts";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

/**
 * A read-only viewer for a past artifact version (spec 27). Opened from the
 * version history; shows that version's body verbatim with its number and
 * timestamp. It never mutates: viewing an old version does not change the draft
 * or create a new version. Escape or the backdrop closes it.
 */
export function VersionViewer({
  version,
  onClose,
}: {
  version: ArtifactVersion;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Version ${version.version}`}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Version {version.version}</h2>
            <p className="text-xs text-ink-muted" title={formatDateTime(version.createdAt)}>
              {formatRelative(version.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close version viewer"
            className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="overflow-auto px-4 py-3 text-sm text-ink">
          <Markdown>{version.body}</Markdown>
        </div>
      </div>
    </div>
  );
}

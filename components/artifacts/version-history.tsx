"use client";

import { useState } from "react";
import { VersionViewer } from "./version-viewer";
import type { ArtifactVersion } from "@/lib/db/artifacts";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

/**
 * The artifact version history (spec 27): a newest-first list where each entry
 * opens that version's body in a read-only viewer. Owns only the "which version
 * is being viewed" state; the versions themselves are read owner-scoped on the
 * server and passed in.
 */
export function VersionHistory({ versions }: { versions: ArtifactVersion[] }) {
  const [viewing, setViewing] = useState<ArtifactVersion | null>(null);

  return (
    <section aria-label="Version history">
      <h2 className="mb-2 text-sm font-semibold text-ink">Version history</h2>
      <ol className="flex flex-col gap-1 text-xs text-ink-muted">
        {versions
          .slice()
          .reverse()
          .map((v) => (
            <li key={v.version}>
              <button
                type="button"
                onClick={() => setViewing(v)}
                className="flex w-full justify-between gap-3 rounded-md px-1 py-1 text-left hover:bg-surface-2 hover:text-ink"
              >
                <span>Version {v.version}</span>
                <span title={formatDateTime(v.createdAt)}>{formatRelative(v.createdAt)}</span>
              </button>
            </li>
          ))}
      </ol>
      {viewing ? <VersionViewer version={viewing} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

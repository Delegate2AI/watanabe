"use client";

import { X } from "lucide-react";
import type { AttachmentChip } from "@/lib/attachments/store";

/**
 * The row of removable file chips above the composer field. Lifted out of the
 * composer so that component stays about input and sending; markup and behavior
 * are unchanged.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentChip[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink"
        >
          {a.name}
          <button
            type="button"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.id)}
            className="text-ink-faint hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

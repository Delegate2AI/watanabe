"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function resolvedTargetPath(targetPath: string): string {
  const relative = targetPath.trim().replace(/^docs\/+/, "");
  return `docs/${relative}`;
}

function audienceLabel(visibility: string): string {
  const audience = visibility.split(",").map((value) => value.trim()).filter(Boolean);
  return audience.length > 0 ? audience.join(", ") : "all-hands";
}

export function PublishConfirmDialog({
  targetPath,
  visibility,
  busy,
  onConfirm,
}: {
  targetPath: string;
  visibility: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  function confirm() {
    setOpen(false);
    onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-surface disabled:opacity-60"
        >
          Publish now
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish now</DialogTitle>
          <DialogDescription>
            This will publish to <code>{resolvedTargetPath(targetPath)}</code> and make it visible
            to {audienceLabel(visibility)} immediately, with no review.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-surface disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Publish now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

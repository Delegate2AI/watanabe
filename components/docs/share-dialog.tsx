"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ShareManager } from "./share-manager";
import type { DocShare, DocLink, ShareOptions } from "@/lib/shared-docs/types";
import type { Person } from "@/lib/people/types";

/**
 * Owner-only Share affordance (spec 28 sharing, redesign 2026-07-22). The header
 * renders a single "Share" button; the whole per-recipient + external-link
 * ShareManager lives inside a dialog instead of a permanent page-bottom section,
 * matching how a document tool exposes sharing. Rendered ONLY for the owner (the
 * page gates on `canManage`); the routes ShareManager calls re-check ownership.
 */
export function ShareDialog({
  id,
  title,
  initialShares,
  initialLinks,
  externalEnabled,
  options = { teams: [], people: [] },
  people = {},
}: {
  id: string;
  title: string;
  initialShares: DocShare[];
  initialLinks: DocLink[];
  externalEnabled: boolean;
  /** Teams and people this owner may share with, resolved server-side. */
  options?: ShareOptions;
  /** Recipients resolved server-side, for <PersonChip> in the share rows. */
  people?: Record<string, Person>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Share2 className="size-4" aria-hidden />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">Share “{title}”</DialogTitle>
          <DialogDescription>
            Choose who can view, comment, or edit this document.
          </DialogDescription>
        </DialogHeader>
        <ShareManager
          id={id}
          initialShares={initialShares}
          initialLinks={initialLinks}
          externalEnabled={externalEnabled}
          options={options}
          people={people}
        />
      </DialogContent>
    </Dialog>
  );
}

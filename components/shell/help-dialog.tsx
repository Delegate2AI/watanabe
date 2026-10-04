"use client";

import { CircleHelp } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useChangeRequestTerms } from "@/components/app-config-provider";

/**
 * The top-right help control (spec 24), replacing spec 18's inert button. Opens
 * an about/feedback dialog: a short description of Watanabe and, when the
 * deployment has one, a link to send feedback.
 *
 * `feedbackHref` comes from `portal.yaml` (`app.feedbackUrl`), resolved
 * server-side in the layout and threaded down, the same way `activityEnabled`
 * is. It used to be a hardcoded `mailto:feedback@example.com`: a placeholder
 * that looked exactly like a working channel while going nowhere
 * (surface-polish P-12c). Unset, the link is not rendered at all.
 */
export function HelpDialog({ feedbackHref }: { feedbackHref?: string }) {
  const terms = useChangeRequestTerms();
  return (
    <Dialog>
      <DialogTrigger
        title="Help & feedback"
        aria-label="Help"
        className="grid size-[34px] place-items-center rounded-full border border-line bg-surface text-ink-muted shadow-card hover:text-ink"
      >
        <CircleHelp className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>About Watanabe</DialogTitle>
          <DialogDescription>
            Watanabe is your team&apos;s workspace. Chat to think, draft, and
            decide; keep what you make private, share it with people, or promote
            it to the knowledge base.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-ink-muted">
          Everything you see is scoped to your clearance. The knowledge base is
          read-only here: to change it, draft in chat, save the result as an
          artifact, then request review, which opens a reviewable {terms.long}.
          Approvers can publish directly when a change does not need review.
        </p>
        {feedbackHref ? (
          <a
            href={feedbackHref}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Send feedback
          </a>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useIdentity } from "@/components/identity-provider";
import { cn } from "@/lib/utils";

/**
 * The top-right "Cleared: All-hands · Exec" pill (spec 18). Reads the clearance
 * set from the one identity context so there is a single place to wire spec 19's
 * real resolver. The dot uses the semantic "good" token, never the brand accent.
 *
 * On narrow viewports the label is hidden (the mock drops `.clearance` under
 * 860px) but the dot stays as a compact affordance.
 */
export function ClearanceBadge({ className }: { className?: string }) {
  const { clearance } = useIdentity();
  // Membership of the `admins` group grants see-all (see lib/authority). Listing
  // the groups then reads as an exhaustive scope when it is not: finance and
  // research content the list never names is still visible. Say "everything"
  // instead, and keep the actual groups in the tooltip.
  const seesAll = clearance.some((group) => group.trim().toLowerCase() === "admins");
  return (
    <span
      title={
        seesAll
          ? `You are in the admins group, so you can see all content (${clearance.join(", ")})`
          : "Content you are cleared to see"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-muted shadow-card",
        className,
      )}
    >
      <span className="size-[7px] rounded-full bg-good" aria-hidden />
      <span className="max-[860px]:sr-only">
        Cleared: <b className="font-semibold text-ink">{seesAll ? "everything" : clearance.join(" · ")}</b>
      </span>
    </span>
  );
}

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Visibility = "all-hands" | "restricted";

/**
 * The shared visibility vocabulary across KB, Tasks, and Meetings (spec 18).
 *
 * `all-hands` reads in the semantic "good" tone with no lock. `restricted`
 * reads in the "warn" tone with a lock and the clearing group's name (e.g.
 * "Exec"). These are semantic colors, deliberately NOT the brand accent, so a
 * restricted item never looks like a primary action.
 */
export function VisibilityChip({
  visibility,
  group,
  className,
}: {
  visibility: Visibility;
  group?: string;
  className?: string;
}) {
  if (visibility === "all-hands") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-0.5 text-[11px] font-semibold text-good",
          className,
        )}
      >
        All-hands
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-semibold text-warn",
        className,
      )}
    >
      <Lock className="size-3 shrink-0" aria-hidden />
      {/* Truncate the group name from the end (with an ellipsis) when the chip
          is width-constrained, e.g. the KB tree's fixed clearance column. It
          used to left-clip inside an overflow-hidden column, rendering
          "Engineering" as "igineering". */}
      <span className="min-w-0 truncate">{group ?? "Restricted"}</span>
    </span>
  );
}

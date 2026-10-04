import { cn } from "@/lib/utils";
import type { EffectiveAccess } from "@/lib/shared-docs/access";

/** The human label for each access level, mirroring the mock's pills. */
const LABEL: Record<EffectiveAccess, string> = {
  owner: "Owner",
  edit: "Can edit",
  comment: "Can comment",
  view: "Can view",
  none: "No access",
};

/**
 * A small access-level pill (spec 28), mirroring the mock's "Can edit" / "Can
 * view" chips. Purely presentational: the level is resolved server-side.
 */
export function AccessPill({ access, className }: { access: EffectiveAccess; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip border border-line bg-surface-2 px-2 py-0.5 text-xs text-ink-muted",
        className,
      )}
    >
      {LABEL[access]}
    </span>
  );
}

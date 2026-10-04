import { cn } from "@/lib/utils";

/**
 * One placeholder bar.
 *
 * The building block for every loading surface in the app. An empty state is a
 * claim about data ("there is nothing here"), and the app may not make that claim
 * before the data arrives: until then it renders these instead.
 *
 * `aria-hidden` because the bars carry no information. The surrounding skeleton
 * owns the single `role="status"` announcement, so a screen reader hears
 * "loading" once rather than a dozen anonymous boxes.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
    />
  );
}

import { Skeleton } from "./skeleton";

/** Row widths that read as prose of differing length rather than a block. */
const WIDTHS = ["78%", "92%", "64%", "85%", "71%", "88%"];

/**
 * The loading state for a vertical list (the sidebar's Recents) or a tree (the
 * knowledge-base navigator, via `tree`).
 *
 * Same rule as the thread: a list that has not loaded is not an empty list. The
 * sidebar previously rendered its Recents heading over nothing while the fetch
 * was in flight, which is indistinguishable from a user who has never chatted.
 *
 * Row widths vary so the placeholder reads as titles of different lengths. In
 * `tree` mode the rows also indent, because a flat block of equal bars would
 * misrepresent the shape of what is arriving.
 */
export function ListSkeleton({
  rows = 4,
  tree = false,
  label = "Loading",
}: {
  rows?: number;
  /** Indent the rows so they read as a hierarchy rather than a flat list. */
  tree?: boolean;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-2 px-2.5 py-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          data-skeleton-row
          style={{ width: WIDTHS[i % WIDTHS.length], marginLeft: tree ? `${(i % 3) * 12}px` : undefined }}
        >
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
}

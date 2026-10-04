import { Skeleton } from "./skeleton";

/**
 * The loading state for a card grid: the artifact and shared-document surfaces.
 *
 * Same rule as the thread and the list. "You have no artifacts yet" is a claim
 * about data, and a grid that is still fetching may not make it. Each placeholder
 * matches the real card's shape (title line, two body lines, a footer chip) so
 * the layout does not reflow when the content lands.
 */
export function GridSkeleton({ cards = 4, label = "Loading" }: { cards?: number; label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"
    >
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          data-skeleton-card
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        >
          <Skeleton className="mb-3 h-4 w-3/5" />
          <Skeleton className="mb-2 h-3 w-full" />
          <Skeleton className="mb-4 h-3 w-4/5" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

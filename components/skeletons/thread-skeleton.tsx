import { Skeleton } from "./skeleton";

/**
 * The chat transcript's loading state.
 *
 * Replaces the two to three seconds in which an existing thread rendered "Ask
 * Watanabe anything about the knowledge base." while its messages were still in
 * flight. That sentence is the EMPTY state: showing it during load told the user
 * their thread was empty, confidently and wrongly. A thread that has content must
 * never render it, at any point during load.
 *
 * Shaped like a transcript (alternating short user turn, longer assistant turn)
 * so the page does not jump when the real content replaces it.
 */
export function ThreadSkeleton({ turns = 3 }: { turns?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading this conversation" className="pt-6">
      {Array.from({ length: turns }, (_, i) => (
        <div key={i} data-skeleton-turn className="mb-8">
          {i % 2 === 0 ? (
            <div className="flex justify-end">
              <Skeleton className="h-9 w-1/2 rounded-2xl" />
            </div>
          ) : (
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { ThreadSkeleton } from "@/components/skeletons/thread-skeleton";

/**
 * Shown while the thread route's server render runs (ownership check, model
 * options, flags), so opening a chat from the sidebar paints instantly instead
 * of leaving the previous page up.
 *
 * Overrides `../loading.tsx`, which is shaped like the chat INDEX: a transcript
 * is not a list, and a placeholder of the wrong shape reflows the moment the
 * real one arrives. The column matches the transcript's own `max-w-3xl`.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-8 pt-14">
      <ThreadSkeleton />
    </div>
  );
}

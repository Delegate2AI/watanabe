import type { Database as DatabaseType } from "better-sqlite3";
import { listThreadsForOwner } from "@/lib/db/threads";

/** One thread as the sidebar renders it (spec 24 Pinned + Recents groups). */
export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinned: boolean;
}

/**
 * The owner's threads, shaped for the sidebar.
 *
 * Shared by `GET /api/threads` and the shell layout, which render the SAME list
 * from the SAME owner-scoped read: the layout so the sidebar arrives with the
 * page instead of after a hydration round trip, the route so client-side
 * mutations can resync. Two copies of this mapping would be two chances for the
 * server-rendered list and the refetched one to disagree, which the user would
 * see as the sidebar changing under them a moment after load.
 *
 * Identity-scoped by construction: `listThreadsForOwner` filters to one email,
 * so this can never surface another user's threads.
 */
export function threadSummaries(db: DatabaseType, ownerEmail: string): ThreadSummary[] {
  return listThreadsForOwner(db, ownerEmail).map((t) => ({
    id: t.sdkSessionId,
    title: t.title ?? "New chat",
    updatedAt: t.updatedAt,
    pinned: t.pinned,
  }));
}

import type { Database as DatabaseType } from "better-sqlite3";
import { getThreadOwner } from "./threads";

/**
 * The resume-ownership check — the thing that keeps user B from reading,
 * resuming, interrupting, or listing user A's threads.
 *
 *  - "own"       → the thread is recorded and owned by the requester.
 *  - "forbidden" → the thread is recorded and owned by someone else.
 *  - "unowned"   → no ownership record exists at all (never created, a
 *    foreign id, or a legacy/pre-migration session). Callers decide how
 *    strict to be per endpoint: content-bearing endpoints (resume a
 *    conversation, read its transcript) MUST treat this as forbidden too —
 *    a session can exist on disk with real prior content even without a DB
 *    row, so silently resuming it would leak that content. No-content
 *    endpoints (context-usage percentage, interrupt) may treat it as a safe
 *    no-op instead, since there is nothing to leak and nothing tracked to
 *    protect.
 */
export type OwnershipCheck = "own" | "unowned" | "forbidden";

export function checkOwnership(db: DatabaseType, sdkSessionId: string, requesterEmail: string): OwnershipCheck {
  const owner = getThreadOwner(db, sdkSessionId);
  if (owner === null) return "unowned";
  return owner === requesterEmail ? "own" : "forbidden";
}

/** Strict variant for content-bearing endpoints: "unowned" counts as forbidden too. */
export function isOwnedBy(db: DatabaseType, sdkSessionId: string, requesterEmail: string): boolean {
  return checkOwnership(db, sdkSessionId, requesterEmail) === "own";
}

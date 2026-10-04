import type { Database as DatabaseType } from "better-sqlite3";
import { isSafeThreadId, worktreeExists } from "@/lib/repo-write";
import { isOwnedBy } from "@/lib/db/ownership";

/**
 * The draft view's access guard (spec 12 D23) — id shape, then ownership,
 * then worktree existence, in that order. Factored out of the vault page and
 * the two `/api/agent/draft*` routes so all three apply the IDENTICAL check
 * rather than three copies that could drift (e.g. one route forgetting the
 * ownership check a sibling route remembers).
 *
 * `db`/`requesterEmail` are passed in by each caller from its own
 * already-resolved identity/connection — this module never touches
 * `getDb()`/`headers()` itself, so it stays testable without mocking Next
 * internals.
 *
 * Three-way (not boolean) because callers react differently to
 * "doesn't exist" vs. "not allowed":
 *  - the vault page treats `"own-but-gone"` and `"invalid-or-forbidden"`
 *    IDENTICALLY — one generic fallback notice for both, so a snooper
 *    poking `?draft=<guessed-id>` can't distinguish "malformed", "someone
 *    else's", and "yours but already submitted/discarded" from the response.
 *  - `GET /api/agent/draft` returns a 200 `{exists:false}` for
 *    `"own-but-gone"` (spec 12 D25 — this is a normal, expected state, not an
 *    error) but a 403 for `"invalid-or-forbidden"`.
 *  - `POST /api/agent/draft/discard` treats `"own-but-gone"` as an idempotent
 *    200 no-op and `"invalid-or-forbidden"` as a 403.
 */
export type DraftAccess = "own-and-live" | "own-but-gone" | "invalid-or-forbidden";

export function checkDraftAccess(db: DatabaseType, sessionId: string, requesterEmail: string): DraftAccess {
  if (!isSafeThreadId(sessionId)) return "invalid-or-forbidden";
  if (!isOwnedBy(db, sessionId, requesterEmail)) return "invalid-or-forbidden";
  return worktreeExists(sessionId) ? "own-and-live" : "own-but-gone";
}

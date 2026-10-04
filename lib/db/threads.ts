import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `threads` table access — the single source of truth for which SDK sessions
 * exist and who owns them (see `./client` for the connection/schema; this
 * module is deliberately DB-instance-agnostic so it's directly unit-testable
 * against an in-memory database, mirroring the old session-registry's
 * pure-helpers-vs-IO split).
 */

export interface ThreadRecord {
  sdkSessionId: string;
  ownerEmail: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  dirty: boolean;
  dreamedAt: string | null;
  pinned: boolean;
}

interface ThreadRow {
  sdk_session_id: string;
  owner_email: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  dirty: number;
  dreamed_at: string | null;
  pinned: number;
}

function fromRow(row: ThreadRow): ThreadRecord {
  return {
    sdkSessionId: row.sdk_session_id,
    ownerEmail: row.owner_email,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
    dreamedAt: row.dreamed_at,
    pinned: row.pinned === 1,
  };
}

const MAX_TITLE = 80;

/** A clean, bounded title from the conversation's first user prompt. */
export function titleFrom(firstPrompt?: string): string {
  const t = (firstPrompt ?? "").trim();
  if (!t) return "New chat";
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE) : t;
}

/**
 * Upsert one thread: create it (with owner + title) the first time we see its
 * id, or bump `updated_at` (and `title`, only when a new one is given) on
 * later turns — mirrors the old registry's `recordTurn`, now owner-aware.
 * Called on session creation and again on each turn result (see
 * `lib/agent/session.ts`).
 */
export function recordThread(
  db: DatabaseType,
  sdkSessionId: string,
  ownerEmail: string,
  title: string | undefined,
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO threads (sdk_session_id, owner_email, title, created_at, updated_at)
     VALUES (@id, @owner, @title, @now, @now)
     ON CONFLICT(sdk_session_id) DO UPDATE SET
       updated_at = @now,
       title = COALESCE(@title, threads.title)`,
  ).run({ id: sdkSessionId, owner: ownerEmail, title: title ?? null, now });
}

/** All threads owned by `ownerEmail`, newest activity first. */
export function listThreadsForOwner(db: DatabaseType, ownerEmail: string): ThreadRecord[] {
  const rows = db
    .prepare(`SELECT * FROM threads WHERE owner_email = ? AND title IS NOT NULL ORDER BY updated_at DESC`)
    .all(ownerEmail) as ThreadRow[];
  return rows.map(fromRow);
}

/**
 * Set (or clear) a thread's pinned flag, scoped to its owner so one user can
 * never pin another's thread (spec 24). Returns `true` when a row was updated
 * (the thread exists AND belongs to `ownerEmail`), `false` otherwise. The
 * route turns a `false` into a 404, keeping foreign and unknown ids
 * indistinguishable (no existence oracle), mirroring the ownership contract.
 */
export function setThreadPinned(
  db: DatabaseType,
  sdkSessionId: string,
  ownerEmail: string,
  pinned: boolean,
): boolean {
  const info = db
    .prepare(`UPDATE threads SET pinned = @pinned WHERE sdk_session_id = @id AND owner_email = @owner`)
    .run({ id: sdkSessionId, owner: ownerEmail, pinned: pinned ? 1 : 0 });
  return info.changes > 0;
}

/**
 * Rename a thread, scoped to its owner so one user can never rename another's
 * (spec 24). The title is stored verbatim; the route bounds and trims it first.
 * Returns `true` when a row was updated (exists AND owned), `false` otherwise,
 * the same ownership contract as {@link setThreadPinned}.
 */
export function setThreadTitle(
  db: DatabaseType,
  sdkSessionId: string,
  ownerEmail: string,
  title: string,
): boolean {
  const info = db
    .prepare(`UPDATE threads SET title = @title WHERE sdk_session_id = @id AND owner_email = @owner`)
    .run({ id: sdkSessionId, owner: ownerEmail, title });
  return info.changes > 0;
}

/**
 * Delete a thread's registry row, scoped to its owner (spec 24). This removes it
 * from the owner's chat lists, and because `isOwnedBy` then returns false,
 * resuming the id 404s. The on-disk SDK session is left untouched: it is simply
 * unreachable without an owning registry row, matching how a foreign/unknown id
 * behaves. Returns `true` when a row was deleted.
 */
export function deleteThread(db: DatabaseType, sdkSessionId: string, ownerEmail: string): boolean {
  const info = db
    .prepare(`DELETE FROM threads WHERE sdk_session_id = @id AND owner_email = @owner`)
    .run({ id: sdkSessionId, owner: ownerEmail });
  return info.changes > 0;
}

/**
 * A thread's stored model/effort override (spec 24), or `null` for either field
 * when it was never set (meaning "use the env default at High"). Returned raw:
 * the caller validates it against the allowlist (`lib/agent/model-options.ts`),
 * so a since-removed model id here never reaches the SDK.
 */
export function getThreadModelChoice(
  db: DatabaseType,
  sdkSessionId: string,
): { model: string | null; effort: string | null } | null {
  const row = db.prepare(`SELECT model, effort FROM threads WHERE sdk_session_id = ?`).get(sdkSessionId) as
    | { model: string | null; effort: string | null }
    | undefined;
  return row ?? null;
}

/**
 * Set a thread's model/effort override, scoped to its owner (one user can never
 * change another's thread). Only the fields PRESENT in `patch` are written, so a
 * partial update (e.g. changing effort alone) never clobbers the other field
 * back to null: this is the fix for sequential model-then-effort choices erasing
 * each other. Pass a field to change it; omit it to leave it as-is. Returns
 * `true` when a row was updated (thread exists AND owned), else `false` (a
 * foreign/unknown id updates zero rows and the route 404s). The route validates
 * the values before calling.
 */
export function setThreadModelChoice(
  db: DatabaseType,
  sdkSessionId: string,
  ownerEmail: string,
  patch: { model?: string; effort?: string },
): boolean {
  const sets: string[] = [];
  const params: Record<string, string> = { id: sdkSessionId, owner: ownerEmail };
  if (patch.model !== undefined) {
    sets.push("model = @model");
    params.model = patch.model;
  }
  if (patch.effort !== undefined) {
    sets.push("effort = @effort");
    params.effort = patch.effort;
  }
  if (sets.length === 0) return false;
  const info = db
    .prepare(`UPDATE threads SET ${sets.join(", ")} WHERE sdk_session_id = @id AND owner_email = @owner`)
    .run(params);
  return info.changes > 0;
}

/** The owner of `sdkSessionId`, or `null` if this store has no record of it. */
export function getThreadOwner(db: DatabaseType, sdkSessionId: string): string | null {
  const row = db.prepare(`SELECT owner_email FROM threads WHERE sdk_session_id = ?`).get(sdkSessionId) as
    | { owner_email: string }
    | undefined;
  return row?.owner_email ?? null;
}

/** Mark a thread as having un-consolidated turns. Called on each turn result. */
export function markDirty(db: DatabaseType, sdkSessionId: string, now: string = new Date().toISOString()): void {
  db.prepare(`UPDATE threads SET dirty = 1, updated_at = @now WHERE sdk_session_id = @id`).run({
    id: sdkSessionId,
    now,
  });
}

/** Threads owned by `ownerEmail` that still need consolidating, oldest activity first. */
export function listDirtyForOwner(db: DatabaseType, ownerEmail: string): ThreadRecord[] {
  const rows = db
    .prepare(`SELECT * FROM threads WHERE owner_email = ? AND dirty = 1 ORDER BY updated_at ASC`)
    .all(ownerEmail) as ThreadRow[];
  return rows.map(fromRow);
}

/** Clear the dirty flag and stamp the consolidation time after a successful dream. */
export function markDreamed(db: DatabaseType, sdkSessionId: string, now: string = new Date().toISOString()): void {
  db.prepare(`UPDATE threads SET dirty = 0, dreamed_at = @now WHERE sdk_session_id = @id`).run({
    id: sdkSessionId,
    now,
  });
}

/** Whether this thread has un-consolidated turns. False for an unknown or already-dreamed thread. */
export function isThreadDirty(db: DatabaseType, sdkSessionId: string): boolean {
  const row = db.prepare(`SELECT dirty FROM threads WHERE sdk_session_id = ?`).get(sdkSessionId) as
    | { dirty: number }
    | undefined;
  return row?.dirty === 1;
}

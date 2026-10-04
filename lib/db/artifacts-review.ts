import type { Database as DatabaseType } from "better-sqlite3";

/**
 * The queries the in-review reconciler needs (spec 27).
 *
 * Split from `lib/db/artifacts.ts` for two reasons. It keeps that file under the
 * size limit, and more importantly these are the only artifact reads in the app
 * that are deliberately NOT owner-scoped: reconciliation is a system job that
 * runs on a timer with no requester, so it has to see every owner's artifacts.
 * Keeping them apart means the owner-scoped contract that governs the rest of
 * `artifacts.ts` cannot be weakened by accident from inside this file.
 */

export interface InReviewArtifact {
  id: string;
  ownerEmail: string;
  title: string;
  mrIid: number;
  /** Where the note will land, checked before a merge is called published. */
  publishedNotePath: string | null;
}

/**
 * Every artifact waiting on a merge request, across all owners.
 *
 * Rows with no `mr_iid` are excluded: without one there is nothing to ask GitLab
 * about, so the reconciler could only leave them alone anyway. That also means
 * artifacts marked in review before the iid column existed are skipped rather
 * than repeatedly re-queried with nothing to query.
 */
export function listInReviewArtifacts(db: DatabaseType): InReviewArtifact[] {
  const rows = db
    .prepare(
      `SELECT id, owner_email, title, mr_iid, published_note_path FROM artifacts
       WHERE status = 'in_review' AND mr_iid IS NOT NULL
       ORDER BY updated_at ASC`,
    )
    .all() as Array<{
      id: string;
      owner_email: string;
      title: string;
      mr_iid: number;
      published_note_path: string | null;
    }>;
  return rows.map((r) => ({
    id: r.id,
    ownerEmail: r.owner_email,
    title: r.title,
    mrIid: r.mr_iid,
    publishedNotePath: r.published_note_path,
  }));
}

/**
 * Hand a rejected proposal back to its author.
 *
 * A merge request that was CLOSED rather than merged is a decision: the note is
 * not going into the knowledge base as written. The artifact returns to `ready`
 * (editable again, publishable again) and its merge request fields are cleared,
 * so the next publish opens a fresh review rather than pointing at a dead one.
 * The published note path is cleared too, since nothing was published.
 */
export function markProposalRejected(
  db: DatabaseType,
  id: string,
  now: string = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(
      `UPDATE artifacts
         SET status = 'ready', mr_url = NULL, mr_iid = NULL, published_note_path = NULL, updated_at = @now
       WHERE id = @id AND status = 'in_review'`,
    )
    .run({ id, now });
  return info.changes > 0;
}

/**
 * Promote a merged proposal to `published`.
 *
 * Deliberately keeps `mr_url`, unlike rejection: the merge request is now the
 * provenance of a live note, and a reader looking at a published artifact should
 * still be able to reach the review it went through. Guarded on `in_review` so a
 * concurrent reconcile cannot double-apply.
 */
export function markProposalMerged(
  db: DatabaseType,
  id: string,
  now: string = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(
      `UPDATE artifacts SET status = 'published', updated_at = @now
       WHERE id = @id AND status = 'in_review'`,
    )
    .run({ id, now });
  return info.changes > 0;
}

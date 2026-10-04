import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Who proposed the change one merge request carries, for the review queue.
 *
 * The two publish paths are keyed differently: `artifacts` carries `mr_iid`,
 * while `shared_doc_publications` carries only `mr_url`, so each is matched on
 * what it actually stores. A chat proposal matches neither, by design: nothing
 * records it locally, and the queue falls back to the merge request itself.
 */
export interface ProposalOrigin {
  owner: string;
  title: string;
  origin: "artifact" | "shared-doc";
}

export function findProposalOrigin(
  db: DatabaseType,
  params: { iid: number; webUrl: string },
): ProposalOrigin | null {
  const artifact = db
    .prepare(
      `SELECT owner_email, title FROM artifacts
       WHERE status = 'in_review' AND mr_iid = @iid
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get({ iid: params.iid }) as { owner_email: string; title: string } | undefined;
  if (artifact) {
    return { owner: artifact.owner_email, title: artifact.title, origin: "artifact" };
  }

  const doc = db
    .prepare(
      `SELECT d.owner_email AS owner_email, d.title AS title
       FROM shared_doc_publications p
       JOIN shared_docs d ON d.id = p.doc_id
       WHERE p.status = 'in_review' AND p.mr_url = @webUrl
       ORDER BY p.updated_at DESC LIMIT 1`,
    )
    .get({ webUrl: params.webUrl }) as { owner_email: string; title: string } | undefined;
  if (doc) {
    return { owner: doc.owner_email, title: doc.title, origin: "shared-doc" };
  }

  return null;
}

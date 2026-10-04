import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  AccessRequestStatus,
  DocAccessRequest,
  SharedAccess,
} from "@/lib/shared-docs/types";

/**
 * `doc_access_requests` (migration v33): a person asking the owner of a shared
 * document for access to it, from the "You need access" screen.
 *
 * ACL-agnostic like its sibling stores: it records and reads rows, and
 * `lib/shared-docs/access.ts` plus the routes decide who may do either. Nothing
 * here grants anything. Granting is a `doc_shares` write the owner's decision
 * makes separately, so a request row can never widen access on its own.
 */

interface RequestRow {
  id: string;
  doc_id: string;
  requester_email: string;
  access: SharedAccess;
  message: string | null;
  status: AccessRequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

function fromRow(row: RequestRow): DocAccessRequest {
  return {
    id: row.id,
    docId: row.doc_id,
    requesterEmail: row.requester_email,
    access: row.access,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
}

const COLUMNS = `id, doc_id, requester_email, access, message, status, created_at, decided_at, decided_by`;

/**
 * Record a request, or update the requester's standing one.
 *
 * Upsert rather than insert, on the partial unique index over pending rows: a
 * person who asks twice (they reload the screen, or they want edit after asking
 * for view) has ONE ask, carrying the latest level and message. Without that,
 * an owner's queue fills with duplicates of the same person and each has to be
 * decided separately.
 *
 * Returns the row as stored, so the caller renders what was actually recorded.
 */
export function requestAccess(
  db: DatabaseType,
  input: { docId: string; requesterEmail: string; access: SharedAccess; message: string | null },
  now: string = new Date().toISOString(),
): DocAccessRequest {
  db.prepare(
    `INSERT INTO doc_access_requests (${COLUMNS})
     VALUES (@id, @doc, @who, @access, @message, 'pending', @now, NULL, NULL)
     ON CONFLICT (doc_id, requester_email) WHERE status = 'pending'
       DO UPDATE SET access = @access, message = @message, created_at = @now`,
  ).run({
    id: randomUUID(),
    doc: input.docId,
    who: input.requesterEmail,
    access: input.access,
    message: input.message,
    now,
  });
  const pending = getPending(db, input.docId, input.requesterEmail);
  // The upsert just wrote it, so this is never null in practice. Falling back to
  // the input rather than asserting keeps the never-throws shape of the store.
  return pending ?? {
    id: "",
    docId: input.docId,
    requesterEmail: input.requesterEmail,
    access: input.access,
    message: input.message,
    status: "pending",
    createdAt: now,
    decidedAt: null,
    decidedBy: null,
  };
}

/** This requester's standing ask on a doc, or null when they have none. */
export function getPending(
  db: DatabaseType,
  docId: string,
  requesterEmail: string,
): DocAccessRequest | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM doc_access_requests
       WHERE doc_id = @doc AND requester_email = @who AND status = 'pending'`,
    )
    .get({ doc: docId, who: requesterEmail }) as RequestRow | undefined;
  return row ? fromRow(row) : null;
}

/** One request by id, scoped to its doc so an id alone cannot reach across documents. */
export function getRequest(db: DatabaseType, docId: string, id: string): DocAccessRequest | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM doc_access_requests WHERE doc_id = @doc AND id = @id`)
    .get({ doc: docId, id }) as RequestRow | undefined;
  return row ? fromRow(row) : null;
}

/** The pending asks on a doc, oldest first, which is the order to answer them in. */
export function listPending(db: DatabaseType, docId: string): DocAccessRequest[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM doc_access_requests
       WHERE doc_id = @doc AND status = 'pending' ORDER BY created_at ASC`,
    )
    .all({ doc: docId }) as RequestRow[];
  return rows.map(fromRow);
}

/**
 * Every pending ask on the docs `ownerEmail` owns, newest first, joined to the
 * document title so the owner's notification can name what is being asked for.
 * Ownership is the join, not a filter applied afterwards: a request on someone
 * else's document can never appear here.
 */
export function listPendingForOwner(
  db: DatabaseType,
  ownerEmail: string,
  since = "",
): Array<DocAccessRequest & { docTitle: string }> {
  const rows = db
    .prepare(
      `SELECT r.id, r.doc_id, r.requester_email, r.access, r.message, r.status,
              r.created_at, r.decided_at, r.decided_by, d.title AS doc_title
       FROM doc_access_requests r JOIN shared_docs d ON d.id = r.doc_id
       WHERE d.owner_email = @owner AND r.status = 'pending' AND r.created_at > @since
       ORDER BY r.created_at DESC`,
    )
    .all({ owner: ownerEmail, since }) as Array<RequestRow & { doc_title: string }>;
  return rows.map((row) => ({ ...fromRow(row), docTitle: row.doc_title }));
}

/**
 * Answer a pending request. Returns false when there was nothing pending under
 * that id, which is how a double-click or a stale panel resolves: the second
 * decision changes nothing rather than overwriting the first one's attribution.
 */
export function decideRequest(
  db: DatabaseType,
  docId: string,
  id: string,
  decision: Exclude<AccessRequestStatus, "pending">,
  decidedBy: string,
  now: string = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(
      `UPDATE doc_access_requests
       SET status = @status, decided_at = @now, decided_by = @by
       WHERE id = @id AND doc_id = @doc AND status = 'pending'`,
    )
    .run({ id, doc: docId, status: decision, by: decidedBy, now });
  return info.changes > 0;
}

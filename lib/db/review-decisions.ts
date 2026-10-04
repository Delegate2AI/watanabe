import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `kb_review_decisions` row access (migration v29): who approved or rejected a
 * knowledge-base proposal.
 *
 * Append-only. GitLab attributes the merge to the bot token, so this table is
 * the only place the deciding human is named, and a row is never updated or
 * deleted once written. Same file-level conventions as the rest of the store:
 * `db` first, named placeholders, and nothing here decides authorization (that
 * is the route, one layer up).
 */

export type DecisionAction = "approve" | "reject";

export interface Decision {
  id: number;
  /** The GitLab merge request number, which is not a row in this database. */
  iid: number;
  actorEmail: string;
  action: DecisionAction;
  paths: string[];
  selfApproval: boolean;
  createdAt: string;
}

interface DecisionRow {
  id: number;
  iid: number;
  actor_email: string;
  action: DecisionAction;
  paths: string;
  self_approval: number;
  created_at: string;
}

/**
 * Paths are stored as JSON. An audit read must never be the thing that takes
 * down the page, so an unreadable value degrades to an empty list.
 */
function parsePaths(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    iid: row.iid,
    actorEmail: row.actor_email,
    action: row.action,
    paths: parsePaths(row.paths),
    selfApproval: row.self_approval !== 0,
    createdAt: row.created_at,
  };
}

/** Write one decision. Called after the merge or close has actually happened. */
export function recordDecision(
  db: DatabaseType,
  d: {
    iid: number;
    actorEmail: string;
    action: DecisionAction;
    paths: string[];
    selfApproval: boolean;
  },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO kb_review_decisions (iid, actor_email, action, paths, self_approval, created_at)
     VALUES (@iid, @actorEmail, @action, @paths, @selfApproval, @now)`,
  ).run({
    iid: d.iid,
    actorEmail: d.actorEmail,
    action: d.action,
    paths: JSON.stringify(d.paths),
    selfApproval: d.selfApproval ? 1 : 0,
    now,
  });
}

/**
 * Every decision on one merge request, oldest first. Ordered by `id` rather than
 * `created_at` so two decisions inside the same millisecond still read back in
 * the order they were written.
 */
export function listDecisions(db: DatabaseType, iid: number): Decision[] {
  const rows = db
    .prepare(`SELECT * FROM kb_review_decisions WHERE iid = @iid ORDER BY id ASC`)
    .all({ iid }) as DecisionRow[];
  return rows.map(fromRow);
}

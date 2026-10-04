import type { Database as DatabaseType } from "better-sqlite3";
import type { ShareRecipientKind } from "@/lib/shared-docs/types";
import { principalMatch } from "./shared-doc-shares";

export interface MeetingActivityCandidate {
  id: string;
  notePath: string;
  createdAt: string;
}

export interface SharedDocActivityCandidate {
  id: string;
  title: string;
  /** The share row's ACL key: an email for a person grant, a group name for a team grant. */
  recipient: string;
  recipientKind: ShareRecipientKind;
  createdAt: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The epoch a person with no cursor is read against. Reading must not create
 * one: stamping a fresh cursor with the current time on first read means a new
 * joiner's first render silently acknowledges everything that happened before
 * they arrived, and their What's New is empty forever after. Only markSeen
 * writes. A missing row therefore reads as "has seen nothing", which is the
 * truth, and every existing item is new to them.
 */
const NEVER_SEEN = "1970-01-01T00:00:00.000Z";

export function getCursor(db: DatabaseType, email: string): string {
  const row = db.prepare(`
    SELECT last_seen_at FROM activity_cursor WHERE email = @email
  `).get({ email: normalizeEmail(email) }) as { last_seen_at: string } | undefined;
  return row?.last_seen_at ?? NEVER_SEEN;
}

export function markSeen(
  db: DatabaseType,
  email: string,
  now: string = new Date().toISOString(),
): string {
  const normalized = normalizeEmail(email);
  db.prepare(`
    INSERT INTO activity_cursor (email, last_seen_at) VALUES (@email, @now)
    ON CONFLICT(email) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)
  `).run({ email: normalized, now });
  return getCursor(db, normalized);
}

export function meetingCandidatesSince(
  db: DatabaseType,
  cursor: string,
): MeetingActivityCandidate[] {
  const rows = db.prepare(`
    SELECT meeting_id, note_path, ingested_at
    FROM ingested_meetings
    WHERE ingested_at > @cursor
    ORDER BY ingested_at DESC, meeting_id ASC
  `).all({ cursor }) as Array<{
    meeting_id: string;
    note_path: string;
    ingested_at: string;
  }>;
  return rows.map((row) => ({
    id: row.meeting_id,
    notePath: row.note_path,
    createdAt: row.ingested_at,
  }));
}

export interface TaskCommentActivityCandidate {
  id: string;
  taskId: string;
  taskTitle: string;
  taskClearance: string[];
  body: string;
  createdAt: string;
  /** True when the requester has themselves commented on this task before. */
  viewerParticipates: boolean;
  isAssignee: boolean;
  isTaskCreator: boolean;
}

/**
 * Every comment since the cursor on a task the requester is cleared for, minus
 * their own, annotated with the three facts that decide involvement. The
 * mention test is deliberately NOT done in SQL: an email may contain LIKE
 * wildcards, and the parser in lib/shared-docs/mentions.ts is already the one
 * definition of what a mention is. The row set is bounded by "new since you
 * last looked", so annotating in SQL and deciding in TypeScript is cheap.
 */
export function taskCommentCandidatesSince(
  db: DatabaseType,
  email: string,
  requesterKeyEmail: string,
  clearance: string[],
  cursor: string,
): TaskCommentActivityCandidate[] {
  const normalized = normalizeEmail(email);
  const rows = db.prepare(`
    SELECT c.id, c.task_id, c.body, c.created_at,
           t.title, t.clearance, t.assignee_email, t.created_by,
           EXISTS (
             SELECT 1 FROM task_comments mine
             WHERE mine.task_id = c.task_id AND mine.author_email = @email
           ) AS participates
    FROM task_comments c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.created_at > @cursor
      AND c.author_email != @email
      AND EXISTS (
        SELECT 1 FROM json_each(t.clearance) task_group
        JOIN json_each(@clearance) requester_group
          ON requester_group.value = task_group.value
      )
    ORDER BY c.created_at DESC, c.id ASC
  `).all({
    email: normalized,
    cursor,
    clearance: JSON.stringify(clearance),
  }) as Array<{
    id: string; task_id: string; body: string; created_at: string;
    title: string; clearance: string; assignee_email: string | null;
    created_by: string | null; participates: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.title,
    taskClearance: JSON.parse(row.clearance) as string[],
    body: row.body,
    createdAt: row.created_at,
    viewerParticipates: row.participates === 1,
    isAssignee: row.assignee_email === requesterKeyEmail,
    isTaskCreator: row.created_by === normalized,
  }));
}

export function sharedDocCandidatesSince(
  db: DatabaseType,
  recipientEmail: string,
  cursor: string,
  groups: string[] = [],
): SharedDocActivityCandidate[] {
  const email = normalizeEmail(recipientEmail);
  // Same principal predicate the ACL uses, so "new to you" and "you can open it"
  // can never disagree: a doc shared with your team must surface here exactly
  // when a team grant actually reaches you.
  const match = principalMatch(groups, "shares");
  const rows = db.prepare(`
    SELECT docs.id, docs.title, shares.recipient_email, shares.recipient_kind, shares.created_at
    FROM doc_shares shares
    JOIN shared_docs docs ON docs.id = shares.doc_id
    WHERE ${match.sql} AND shares.created_at > @cursor AND docs.owner_email <> @who
    ORDER BY shares.created_at DESC, docs.id ASC
  `).all({ who: email, cursor, ...match.binds }) as Array<{
    id: string;
    title: string;
    recipient_email: string;
    recipient_kind: ShareRecipientKind;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    recipient: row.recipient_email,
    recipientKind: row.recipient_kind,
    createdAt: row.created_at,
  }));
}

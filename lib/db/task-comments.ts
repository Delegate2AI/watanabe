import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Comments on a task (spec 2026-08-07). Flat and chronological: no thread
 * table, no anchors, no resolve axis.
 *
 * Every statement that touches a single comment is scoped by `task_id` as well
 * as `id`. The routes above authorize a caller on ONE task, so a comment id
 * belonging to a different task, guessed or leaked, must not be reachable
 * through that authorization. This is the same IDOR defense the doc comment
 * module documents at lib/db/comment-threads.ts:46.
 */

export interface TaskComment {
  id: string;
  taskId: string;
  authorEmail: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

interface CommentRow {
  id: string;
  task_id: string;
  author_email: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function fromRow(row: CommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

export function addComment(
  db: DatabaseType,
  input: { id: string; taskId: string; authorEmail: string; body: string; createdAt: string },
): TaskComment {
  const authorEmail = normalizeEmail(input.authorEmail);
  db.prepare(
    `INSERT INTO task_comments (id, task_id, author_email, body, created_at, edited_at)
     VALUES (@id, @taskId, @authorEmail, @body, @createdAt, null)`,
  ).run({ ...input, authorEmail });
  return { ...input, authorEmail, editedAt: null };
}

/** Oldest first: a discussion reads top to bottom. */
export function listComments(db: DatabaseType, taskId: string): TaskComment[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_comments WHERE task_id = @taskId
       ORDER BY created_at ASC, id ASC`,
    )
    .all({ taskId }) as CommentRow[];
  return rows.map(fromRow);
}

/**
 * One comment, scoped by `id` AND `task_id`. Callers that already hold a
 * comment id (edit, delete) should reach for this instead of hydrating the
 * whole discussion with listComments and filtering in JavaScript. The
 * task_id scope is the same IDOR boundary documented at the top of this
 * file: a real id from a different task must come back null, not the row.
 */
export function getComment(db: DatabaseType, id: string, taskId: string): TaskComment | null {
  const row = db
    .prepare(`SELECT * FROM task_comments WHERE id = @id AND task_id = @taskId`)
    .get({ id, taskId }) as CommentRow | undefined;
  return row ? fromRow(row) : null;
}

/** False when nothing matched: wrong id, wrong task, or not the author. */
export function editComment(
  db: DatabaseType,
  input: { id: string; taskId: string; authorEmail: string; body: string; editedAt: string },
): boolean {
  return (
    db
      .prepare(
        `UPDATE task_comments SET body = @body, edited_at = @editedAt
         WHERE id = @id AND task_id = @taskId AND author_email = @authorEmail`,
      )
      .run({ ...input, authorEmail: normalizeEmail(input.authorEmail) }).changes > 0
  );
}

/**
 * Hard delete. `authorEmail: null` means an administrator, so the author clause
 * is dropped, but the `task_id` scope never is.
 */
export function deleteComment(
  db: DatabaseType,
  input: { id: string; taskId: string; authorEmail: string | null },
): boolean {
  if (input.authorEmail === null) {
    return (
      db
        .prepare(`DELETE FROM task_comments WHERE id = @id AND task_id = @taskId`)
        .run({ id: input.id, taskId: input.taskId }).changes > 0
    );
  }
  return (
    db
      .prepare(`DELETE FROM task_comments WHERE id = @id AND task_id = @taskId AND author_email = @authorEmail`)
      .run({ id: input.id, taskId: input.taskId, authorEmail: normalizeEmail(input.authorEmail) }).changes > 0
  );
}

/**
 * One statement for the whole board, never a query per card. Tasks with no
 * comments are absent from the map rather than present as 0, so the card can
 * treat `undefined` and "nothing to show" as the same thing.
 */
export function countsForTasks(db: DatabaseType, taskIds: string[]): Record<string, number> {
  const unique = [...new Set(taskIds)];
  if (unique.length === 0) return {};
  const params: Record<string, string> = {};
  const placeholders = unique.map((id, index) => {
    params[`id${index}`] = id;
    return `@id${index}`;
  });
  const rows = db
    .prepare(
      `SELECT task_id, COUNT(*) AS n FROM task_comments
       WHERE task_id IN (${placeholders.join(", ")}) GROUP BY task_id`,
    )
    .all(params) as Array<{ task_id: string; n: number }>;
  return Object.fromEntries(rows.map((row) => [row.task_id, row.n]));
}

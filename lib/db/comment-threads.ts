import type { Database as DatabaseType } from "better-sqlite3";
import type { CommentMessage, CommentThread, TextAnchor } from "@/lib/shared-docs/types";

interface ThreadRow {
  id: string;
  doc_id: string;
  anchor_json: string | null;
  status: "open" | "resolved";
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
}
interface MessageRow {
  id: string;
  thread_id: string;
  author_email: string;
  body: string;
  created_at: string;
}

/** Create a thread and its first message in one transaction. */
export function createThread(
  db: DatabaseType,
  input: {
    id: string; docId: string; anchor: TextAnchor | null; createdBy: string;
    createdAt: string; body: string; messageId: string;
  },
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO doc_comment_threads (id, doc_id, anchor_json, status, created_by, created_at)
       VALUES (@id, @doc, @anchor, 'open', @by, @at)`,
    ).run({
      id: input.id, doc: input.docId,
      anchor: input.anchor ? JSON.stringify(input.anchor) : null,
      by: input.createdBy, at: input.createdAt,
    });
    db.prepare(
      `INSERT INTO doc_comment_messages (id, thread_id, author_email, body, created_at)
       VALUES (@id, @thread, @author, @body, @at)`,
    ).run({ id: input.messageId, thread: input.id, author: input.createdBy, body: input.body, at: input.createdAt });
  })();
}

/**
 * Append a reply. Returns false if the thread does not exist ON `docId` -- the
 * existence check is scoped by doc_id so a thread id from another document
 * (guessed or leaked) can never be mutated through a caller only authorized on
 * `docId` (spec 2026-07-22 IDOR fix).
 */
export function addReply(
  db: DatabaseType,
  input: { id: string; threadId: string; docId: string; authorEmail: string; body: string; createdAt: string },
): boolean {
  const exists = db
    .prepare(`SELECT 1 FROM doc_comment_threads WHERE id = @t AND doc_id = @doc`)
    .get({ t: input.threadId, doc: input.docId });
  if (!exists) return false;
  db.prepare(
    `INSERT INTO doc_comment_messages (id, thread_id, author_email, body, created_at)
     VALUES (@id, @thread, @author, @body, @at)`,
  ).run({ id: input.id, thread: input.threadId, author: input.authorEmail, body: input.body, at: input.createdAt });
  return true;
}

/**
 * Set a thread open/resolved. `resolvedBy`/`at` are cleared when reopening.
 * The UPDATE is scoped by `doc_id` so a thread id from another document can
 * never be resolved/reopened through a caller only authorized on `docId`
 * (spec 2026-07-22 IDOR fix).
 */
export function setThreadStatus(
  db: DatabaseType,
  threadId: string,
  docId: string,
  status: "open" | "resolved",
  resolvedBy: string | null,
  at: string,
): boolean {
  const changes = db
    .prepare(
      `UPDATE doc_comment_threads
       SET status = @status,
           resolved_by = @by,
           resolved_at = @at
       WHERE id = @id AND doc_id = @doc`,
    )
    .run({
      id: threadId, doc: docId, status,
      by: status === "resolved" ? resolvedBy : null,
      at: status === "resolved" ? at : null,
    }).changes;
  return changes > 0;
}

/** Every thread on a doc (newest thread first), each with its messages oldest-first. */
export function listThreads(db: DatabaseType, docId: string): CommentThread[] {
  const threads = db
    .prepare(`SELECT * FROM doc_comment_threads WHERE doc_id = @doc ORDER BY created_at DESC`)
    .all({ doc: docId }) as ThreadRow[];
  if (threads.length === 0) return [];
  const messages = db
    .prepare(
      `SELECT m.* FROM doc_comment_messages m
       JOIN doc_comment_threads t ON t.id = m.thread_id
       WHERE t.doc_id = @doc ORDER BY m.created_at ASC`,
    )
    .all({ doc: docId }) as MessageRow[];
  const byThread = new Map<string, CommentMessage[]>();
  for (const m of messages) {
    const list = byThread.get(m.thread_id) ?? [];
    list.push({ id: m.id, authorEmail: m.author_email, body: m.body, createdAt: m.created_at });
    byThread.set(m.thread_id, list);
  }
  return threads.map((t) => ({
    id: t.id,
    docId: t.doc_id,
    anchor: t.anchor_json ? (JSON.parse(t.anchor_json) as TextAnchor) : null,
    status: t.status,
    createdBy: t.created_by,
    createdAt: t.created_at,
    resolvedBy: t.resolved_by,
    resolvedAt: t.resolved_at,
    messages: byThread.get(t.id) ?? [],
  }));
}

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `doc_threads` table access (the doc copilot, spec 2026-08-27): which shared
 * document a chat thread's copilot session is bound to. A thread belongs to at
 * most one document (thread_id is the PRIMARY KEY); a user may open several
 * copilot threads on one document over time, and the panel resumes the newest
 * (`latestThreadForDoc`). Authorization is NOT this module's job: the agent
 * route checks the flag and the doc ACL before a binding is ever written, and
 * re-checks on every resume.
 */

/** Bind a thread to a document. Idempotent upsert: re-registering the same session refreshes nothing but is harmless. */
export function bindDocThread(
  db: DatabaseType,
  threadId: string,
  docId: string,
  ownerEmail: string,
  now: string = new Date().toISOString(),
): void {
  db.prepare(`
    INSERT INTO doc_threads (thread_id, doc_id, owner_email, created_at)
    VALUES (@threadId, @docId, @ownerEmail, @now)
    ON CONFLICT(thread_id) DO UPDATE SET doc_id = @docId
  `).run({ threadId, docId, ownerEmail, now });
}

/** The document a thread is bound to, or null for an unbound/unknown thread. */
export function docForThread(db: DatabaseType, threadId: string): { docId: string; ownerEmail: string } | null {
  const row = db
    .prepare(`SELECT doc_id, owner_email FROM doc_threads WHERE thread_id = @threadId`)
    .get({ threadId }) as { doc_id: string; owner_email: string } | undefined;
  return row ? { docId: row.doc_id, ownerEmail: row.owner_email } : null;
}

/** This user's newest copilot thread on a document, or null when they have none. */
export function latestThreadForDoc(db: DatabaseType, docId: string, ownerEmail: string): string | null {
  const row = db
    .prepare(
      `SELECT thread_id FROM doc_threads
       WHERE doc_id = @docId AND owner_email = @ownerEmail
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get({ docId, ownerEmail }) as { thread_id: string } | undefined;
  return row ? row.thread_id : null;
}

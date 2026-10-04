/**
 * Clears every table and directory the demo seed owns, so the seeder is
 * re-runnable instead of failing on primary-key conflicts the second time.
 *
 * Deliberately destructive on a LOCAL dev database: it removes hand-made test
 * rows in these tables too. It never touches `job_runs`, `job_cursors` (beyond
 * the one cursor the seed sets), or anything outside this list.
 */
import { rmSync } from "node:fs";
import type { Database as DatabaseType } from "better-sqlite3";
import { projectDocsRoot } from "@/lib/projects/doc-store";

/** Child-before-parent order: the schema has real foreign keys in places. */
const TABLES = [
  "chat_document_promotions",
  "chat_document_versions",
  "chat_documents",
  "doc_suggestions",
  "doc_comment_messages",
  "doc_comment_threads",
  "doc_comments",
  "doc_links",
  "doc_shares",
  "shared_doc_versions",
  "shared_docs",
  "artifact_versions",
  "artifacts",
  "project_documents",
  "project_threads",
  "tasks",
  "projects",
  "threads",
  "packages",
  "ingested_meetings",
  "meetings",
  "activity_cursor",
];

export function resetSeedData(db: DatabaseType): string[] {
  const cleared: string[] = [];
  db.transaction(() => {
    for (const table of TABLES) {
      const exists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = @table`)
        .get({ table });
      if (!exists) continue;
      const before = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
      db.prepare(`DELETE FROM "${table}"`).run();
      if (before > 0) cleared.push(`${table} (${before})`);
    }
  })();

  // Project-document bytes live outside the DB; a stale file would otherwise
  // survive with no row pointing at it.
  rmSync(projectDocsRoot(), { recursive: true, force: true });
  return cleared;
}

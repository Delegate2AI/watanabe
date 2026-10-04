import type { Database as DatabaseType } from "better-sqlite3";
import { getProjectForRequester } from "./projects";
import { getThreadOwner } from "./threads";

export function projectContextForThread(
  db: DatabaseType,
  threadId: string,
  requesterEmail: string,
  requesterClearance: string[],
): string | undefined {
  const owner = getThreadOwner(db, threadId);
  if (owner === null || owner.trim().toLowerCase() !== requesterEmail.trim().toLowerCase()) return undefined;
  const row = db
    .prepare(`SELECT project_id FROM project_threads WHERE thread_id = @threadId`)
    .get({ threadId }) as { project_id: string } | undefined;
  if (!row) return undefined;
  const context = getProjectForRequester(db, row.project_id, requesterEmail, requesterClearance)?.context?.trim();
  return context ? context : undefined;
}

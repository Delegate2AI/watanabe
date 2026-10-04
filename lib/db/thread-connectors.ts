import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `thread_connectors` access (spec 33): which external MCP connectors a
 * thread has opted into. A row's presence means "enabled"; there is no
 * disabled row, disabling just deletes it.
 *
 * Deliberately dumb: this module stores and returns slugs verbatim, with no
 * opinion on whether the slug is still present in the connector registry. A
 * slug the registry no longer knows about is still returned here. Filtering
 * against the live registry happens at the grants layer, at read time there,
 * not here.
 */

/** Enabled connector slugs for a thread, sorted. */
export function listThreadConnectors(db: DatabaseType, threadId: string): string[] {
  const rows = db
    .prepare(`SELECT connector_slug FROM thread_connectors WHERE thread_id = @threadId ORDER BY connector_slug ASC`)
    .all({ threadId }) as Array<{ connector_slug: string }>;
  return rows.map((r) => r.connector_slug);
}

/**
 * Enable or disable a connector for a thread. Returns whether the row
 * actually changed: enabling an already-enabled slug, or disabling a slug
 * that was never enabled, both return false.
 */
export function setThreadConnector(
  db: DatabaseType,
  threadId: string,
  slug: string,
  enabled: boolean,
  now: string = new Date().toISOString(),
): boolean {
  if (enabled) {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO thread_connectors (thread_id, connector_slug, enabled_at)
         VALUES (@threadId, @slug, @now)`,
      )
      .run({ threadId, slug, now });
    return info.changes > 0;
  }
  const info = db
    .prepare(`DELETE FROM thread_connectors WHERE thread_id = @threadId AND connector_slug = @slug`)
    .run({ threadId, slug });
  return info.changes > 0;
}

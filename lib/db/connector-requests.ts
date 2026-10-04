import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "crypto";

export interface ConnectorRequest {
  id: string;
  requesterEmail: string;
  text: string;
  createdAt: string;
}

export function createConnectorRequest(
  db: DatabaseType,
  { requesterEmail, text }: { requesterEmail: string; text: string },
  now: string = new Date().toISOString(),
): string {
  const id = randomUUID();
  const trimmedText = text.trim();
  db.prepare(
    `INSERT INTO connector_requests (id, requester_email, text, created_at)
     VALUES (@id, @requesterEmail, @text, @now)`,
  ).run({ id, requesterEmail, text: trimmedText, now });
  return id;
}

export function listOpenConnectorRequests(db: DatabaseType): ConnectorRequest[] {
  const rows = db
    .prepare(
      `SELECT id, requester_email, text, created_at
       FROM connector_requests
       WHERE resolved_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string; requester_email: string; text: string; created_at: string }>;

  return rows.map((r) => ({
    id: r.id,
    requesterEmail: r.requester_email,
    text: r.text,
    createdAt: r.created_at,
  }));
}

export function countOpenConnectorRequests(db: DatabaseType): number {
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM connector_requests WHERE resolved_at IS NULL`)
    .get() as { count: number };
  return result.count;
}

export function resolveConnectorRequest(
  db: DatabaseType,
  id: string,
  resolverEmail: string,
  now: string = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(
      `UPDATE connector_requests
       SET resolved_at = @now, resolved_by = @resolverEmail
       WHERE id = @id AND resolved_at IS NULL`,
    )
    .run({ id, now, resolverEmail });
  return info.changes > 0;
}

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Raw Circleback webhook bodies, keyed by meeting id.
 *
 * This is the source of truth for any meeting that arrived by push rather than
 * by poll: see the v19 -> v20 migration for why it cannot be re-fetched. The
 * body is kept as the exact JSON string that was signed and verified, so the
 * stored bytes are the ones the signature covered.
 */

export interface MeetingPayload {
  meetingId: string;
  payload: string;
  receivedAt: string;
}

type MeetingPayloadRow = { meeting_id: string; payload: string; received_at: string };

/**
 * Last write wins. Circleback re-fires the automation when it revises a
 * meeting's notes or transcript, and the revision is what we want to ingest:
 * `runner.ts` compares the resulting source hash and rewrites the note only if
 * it actually changed, so an unchanged re-delivery still costs no commit.
 */
export function upsertMeetingPayload(
  db: DatabaseType,
  meetingId: string,
  payload: string,
  now = new Date().toISOString(),
): void {
  db.prepare(`
    INSERT INTO meeting_payloads (meeting_id, payload, received_at)
    VALUES (@meetingId, @payload, @now)
    ON CONFLICT(meeting_id) DO UPDATE SET
      payload = excluded.payload,
      received_at = excluded.received_at
  `).run({ meetingId, payload, now });
}

export function getMeetingPayload(db: DatabaseType, meetingId: string): MeetingPayload | null {
  const row = db
    .prepare("SELECT * FROM meeting_payloads WHERE meeting_id = @meetingId")
    .get({ meetingId }) as MeetingPayloadRow | undefined;
  if (!row) return null;
  return { meetingId: row.meeting_id, payload: row.payload, receivedAt: row.received_at };
}

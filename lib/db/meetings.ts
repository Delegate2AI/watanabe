import type { Database as DatabaseType } from "better-sqlite3";
import { getCursor, setCursor } from "@/lib/jobs/state";

export type MeetingState = "queued" | "processing" | "done" | "error";

export interface MeetingJob {
  id: string;
  state: MeetingState;
  error: string | null;
  updatedAt: string;
}

export interface IngestedMeeting {
  meetingId: string;
  notePath: string;
  sourceHash: string;
  ingestedAt: string;
}

type MeetingRow = { id: string; state: MeetingState; error: string | null; updated_at: string };
type IngestedRow = { meeting_id: string; note_path: string; source_hash: string; ingested_at: string };

function meetingFromRow(row: MeetingRow): MeetingJob {
  return { id: row.id, state: row.state, error: row.error, updatedAt: row.updated_at };
}

function ingestedFromRow(row: IngestedRow): IngestedMeeting {
  return {
    meetingId: row.meeting_id,
    notePath: row.note_path,
    sourceHash: row.source_hash,
    ingestedAt: row.ingested_at,
  };
}

export function insertMeetingJob(db: DatabaseType, id: string, now = new Date().toISOString()): void {
  db.prepare(`
    INSERT INTO meetings (id, state, error, updated_at) VALUES (@id, 'queued', NULL, @now)
    ON CONFLICT(id) DO UPDATE SET state = 'queued', error = NULL, updated_at = excluded.updated_at
    WHERE meetings.state IN ('done', 'error')
  `).run({ id, now });
}

export function getMeetingJob(db: DatabaseType, id: string): MeetingJob | null {
  const row = db.prepare("SELECT * FROM meetings WHERE id = @id").get({ id }) as MeetingRow | undefined;
  return row ? meetingFromRow(row) : null;
}

function setMeetingState(
  db: DatabaseType,
  id: string,
  state: MeetingState,
  error: string | null,
  now: string,
): void {
  db.prepare(`
    UPDATE meetings SET state = @state, error = @error, updated_at = @now WHERE id = @id
  `).run({ id, state, error, now });
}

export function markMeetingProcessing(db: DatabaseType, id: string, now = new Date().toISOString()): void {
  setMeetingState(db, id, "processing", null, now);
}

export function markMeetingDone(db: DatabaseType, id: string, now = new Date().toISOString()): void {
  setMeetingState(db, id, "done", null, now);
}

export function markMeetingError(db: DatabaseType, id: string, error: string, now = new Date().toISOString()): void {
  setMeetingState(db, id, "error", error, now);
}

export function requeueStuckMeetings(db: DatabaseType, now = new Date().toISOString()): string[] {
  const rows = db.prepare("SELECT id FROM meetings WHERE state = 'processing' ORDER BY id").all() as Array<{ id: string }>;
  db.prepare(`UPDATE meetings SET state = 'queued', error = NULL, updated_at = @now WHERE state = 'processing'`).run({ now });
  return rows.map((row) => row.id);
}

/**
 * Move every `error` meeting that still has its stored webhook payload back to
 * `queued`, and name them so the caller can enqueue each one.
 *
 * A meeting that failed to parse is otherwise stranded: Circleback re-fires
 * only when it revises the meeting, and the poll cursor has already advanced
 * past it. The payload row is what makes the replay possible, so a meeting
 * without one is left alone: re-queueing it would only send the runner back to
 * an API that cannot read another member's meeting.
 */
export function requeueFailedMeetings(db: DatabaseType, now = new Date().toISOString()): string[] {
  const selectable = `
    SELECT id FROM meetings
    WHERE state = 'error'
      AND id IN (SELECT meeting_id FROM meeting_payloads)
    ORDER BY id
  `;
  const rows = db.prepare(selectable).all() as Array<{ id: string }>;
  db.prepare(`
    UPDATE meetings SET state = 'queued', error = NULL, updated_at = @now
    WHERE state = 'error' AND id IN (SELECT meeting_id FROM meeting_payloads)
  `).run({ now });
  return rows.map((row) => row.id);
}

export function listQueuedMeetingIds(db: DatabaseType): string[] {
  const rows = db.prepare("SELECT id FROM meetings WHERE state = 'queued' ORDER BY id").all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function getIngestedMeeting(db: DatabaseType, meetingId: string): IngestedMeeting | null {
  const row = db.prepare("SELECT * FROM ingested_meetings WHERE meeting_id = @meetingId").get({ meetingId }) as
    | IngestedRow
    | undefined;
  return row ? ingestedFromRow(row) : null;
}

export function upsertIngestedMeeting(db: DatabaseType, meeting: IngestedMeeting): void {
  db.prepare(`
    INSERT INTO ingested_meetings (meeting_id, note_path, source_hash, ingested_at)
    VALUES (@meetingId, @notePath, @sourceHash, @ingestedAt)
    ON CONFLICT(meeting_id) DO UPDATE SET
      source_hash = excluded.source_hash, ingested_at = excluded.ingested_at
  `).run(meeting);
}

const POLL_JOB = "meetings-poll";

export function getIngestCursor(db: DatabaseType): string | null {
  return getCursor(db, POLL_JOB);
}

export function setIngestCursor(db: DatabaseType, value: string): void {
  setCursor(db, POLL_JOB, value);
}

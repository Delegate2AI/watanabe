import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  fromRow,
  type ManualTaskInput,
  type ProposedTask,
  type TaskRecord,
  type TaskRow,
  type TaskStatus,
} from "./tasks-rows";
import type { KbTaskLink } from "@/lib/kb/graph-tasks";
import { assigneeWrite } from "./task-assignees";
import { boardVisibleWhere, clearanceWhere, groupWhere, requesterKey, visibleWhere } from "./tasks-visibility";

export { canTransition } from "@/lib/tasks/lifecycle";
export type { TaskAction, TransitionDenial, TransitionResult } from "@/lib/tasks/lifecycle";
export { acceptTask, setVisibleStatus } from "@/lib/tasks/status-writes";

export { fromRow, parseStringArray } from "./tasks-rows";
export type {
  ManualTaskInput,
  ProposedTask,
  TaskOrigin,
  TaskRecord,
  TaskRow,
  TaskStatus,
} from "./tasks-rows";

/**
 * Insert a task that nobody claimed authorship of. Meeting ingestion and the
 * agent both land here, so created_by is bound NULL. A task with a real human
 * author goes through createManualTask, which records who that was.
 */
export function insertProposed(db: DatabaseType, task: ProposedTask): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO tasks (
      id, title, description, assignee_email, assignees, source_meeting_id,
      source_note_path, clearance, source_attendees, status, due, origin,
      created_by, created_at
    ) VALUES (
      @id, @title, @description, @assigneeEmail, @assignees, @sourceMeetingId,
      @sourceNotePath, @clearance, @sourceAttendees, 'proposed', @due, @origin,
      @createdBy, @createdAt
    )
  `).run({
    ...task,
    ...assigneeWrite(task.assignees ?? [task.assigneeEmail]),
    createdBy: null,
    clearance: JSON.stringify(task.clearance),
    sourceAttendees: JSON.stringify(task.sourceAttendees ?? []),
  });
  return result.changes > 0;
}

export function createManualTask(db: DatabaseType, input: ManualTaskInput): TaskRecord {
  const written = assigneeWrite(input.assignees);
  const record: TaskRecord = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    assigneeEmail: written.assigneeEmail,
    assignees: JSON.parse(written.assignees) as string[],
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: input.clearance,
    // A manual task has no meeting behind it, so there is nobody to grant by
    // attendance. The column default says the same thing.
    sourceAttendees: [],
    status: "open",
    due: input.due,
    origin: "manual",
    createdBy: input.createdBy.trim().toLowerCase(),
    createdAt: input.createdAt,
  };
  db.prepare(`
    INSERT INTO tasks (
      id, title, description, assignee_email, assignees, source_meeting_id,
      source_note_path, clearance, status, due, origin, created_by, created_at
    ) VALUES (
      @id, @title, @description, @assigneeEmail, @assignees, NULL,
      NULL, @clearance, 'open', @due, 'manual', @createdBy, @createdAt
    )
  `).run({
    id: record.id,
    title: record.title,
    description: record.description,
    ...written,
    clearance: JSON.stringify(record.clearance),
    due: record.due,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
  });
  return record;
}

export function getForRequester(
  db: DatabaseType,
  requesterEmail: string,
  requesterClearance: string[],
  statuses?: TaskStatus[],
): TaskRecord[] {
  const statusWhere = statuses && statuses.length > 0
    ? `AND tasks.status IN (${statuses.map((_, index) => `@status${index}`).join(", ")})`
    : "AND tasks.status != 'dismissed'";
  const params: Record<string, string> = {
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  };
  statuses?.forEach((status, index) => { params[`status${index}`] = status; });
  const rows = db.prepare(`
    SELECT * FROM tasks WHERE ${visibleWhere()} ${statusWhere}
    ORDER BY created_at DESC, id ASC
  `).all(params) as TaskRow[];
  return rows.map(fromRow);
}

export function getTaskForRequester(
  db: DatabaseType,
  id: string,
  requesterEmail: string,
  requesterClearance: string[],
): TaskRecord | null {
  const row = db.prepare(`
    SELECT * FROM tasks WHERE id = @id AND ${visibleWhere()}
  `).get({
    id,
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  }) as TaskRow | undefined;
  return row ? fromRow(row) : null;
}

export function getVisibleTask(
  db: DatabaseType,
  id: string,
  requesterEmail: string,
  requesterClearance: string[],
): TaskRecord | null {
  const row = db.prepare(`
    SELECT * FROM tasks WHERE id = @id AND ${clearanceWhere()}
  `).get({
    id,
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  }) as TaskRow | undefined;
  return row ? fromRow(row) : null;
}

export function getBoardTasks(
  db: DatabaseType,
  requesterEmail: string,
  requesterClearance: string[],
): TaskRecord[] {
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE ${boardVisibleWhere()} AND tasks.status != 'dismissed'
    ORDER BY created_at DESC, id ASC
  `).all({
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  }) as TaskRow[];
  return rows.map(fromRow);
}

export function getBoardTaskForRequester(
  db: DatabaseType,
  id: string,
  requesterEmail: string,
  requesterClearance: string[],
): TaskRecord | null {
  const row = db.prepare(`
    SELECT * FROM tasks WHERE id = @id AND ${boardVisibleWhere()}
  `).get({
    id,
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  }) as TaskRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * The tasks the KB graph overlays as nodes (spec 2026-08-17-kb-task-links).
 * Group-intersection only, deliberately without the attendee grant: see the
 * note on `groupWhere`. Dismissed tasks are excluded because a dismissal says
 * "this was not real work"; `done` renders, because a completed item is still
 * part of what the meeting produced.
 *
 * NEVER THROWS: this feeds an overlay on an existing surface, and the graph
 * without its overlay is not an error state, it is yesterday's feature.
 */
export function listKbAnchoredTasks(db: DatabaseType, requesterClearance: string[]): KbTaskLink[] {
  try {
    const rows = db.prepare(`
      SELECT id, title, source_note_path FROM tasks
      WHERE source_note_path IS NOT NULL AND status != 'dismissed' AND ${groupWhere()}
      ORDER BY source_note_path, id
    `).all({
      requesterClearance: JSON.stringify(requesterClearance),
    }) as { id: string; title: string; source_note_path: string }[];
    return rows.map((row) => ({ id: row.id, title: row.title, sourceNotePath: row.source_note_path }));
  } catch {
    return [];
  }
}

/**
 * The tasks a meeting produced, as the "Action items" panel on that meeting's
 * note shows them (spec 2026-08-17-kb-task-links). Unlike the graph overlay
 * this surface is per-request and per-user, so it composes the FULL
 * `clearanceWhere()` including the attendee grant: the person an item was
 * agreed with sees it on the note whenever they can see the note at all.
 */
export function listVisibleByMeeting(
  db: DatabaseType,
  sourceMeetingId: string,
  requesterEmail: string,
  requesterClearance: string[],
): TaskRecord[] {
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE source_meeting_id = @sourceMeetingId AND ${clearanceWhere()}
    ORDER BY created_at, id
  `).all({
    sourceMeetingId,
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  }) as TaskRow[];
  return rows.map(fromRow);
}

export function listByMeeting(db: DatabaseType, sourceMeetingId: string): TaskRecord[] {
  const rows = db.prepare(`
    SELECT * FROM tasks WHERE source_meeting_id = @sourceMeetingId ORDER BY created_at, id
  `).all({ sourceMeetingId }) as TaskRow[];
  return rows.map(fromRow);
}

export function taskExists(db: DatabaseType, id: string): boolean {
  return db.prepare("SELECT 1 FROM tasks WHERE id = @id").get({ id }) !== undefined;
}

/**
 * `completed_at` is written here, the one place status changes, so it can never
 * disagree with `status`. Reopening clears it rather than leaving a stamp on a
 * task that is no longer done.
 */
export function setStatus(
  db: DatabaseType,
  id: string,
  status: TaskStatus,
  requesterEmail?: string,
  requesterClearance?: string[],
  now: string = new Date().toISOString(),
): boolean {
  const scoped = requesterEmail !== undefined && requesterClearance !== undefined;
  const result = db.prepare(`
    UPDATE tasks SET status = @status, completed_at = @completedAt WHERE id = @id
    ${scoped ? `AND ${visibleWhere()}` : ""}
  `).run({
    id,
    status,
    completedAt: status === "done" ? now : null,
    requesterEmail: requesterEmail === undefined ? "" : requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance ?? []),
  });
  return result.changes > 0;
}

/** Both columns move together, so `assignee_email` is always `assignees[0]`. */
export function assignTask(
  db: DatabaseType,
  id: string,
  assigneeEmails: string[],
  requesterEmail: string,
  requesterClearance: string[],
): boolean {
  const result = db.prepare(`
    UPDATE tasks SET assignee_email = @assigneeEmail, assignees = @assignees
    WHERE id = @id AND assignee_email IS NULL AND status = 'proposed' AND ${visibleWhere()}
  `).run({
    id,
    ...assigneeWrite(assigneeEmails),
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  });
  return result.changes > 0;
}

export function reassignTask(
  db: DatabaseType,
  id: string,
  assigneeEmails: string[],
  requesterEmail: string,
  requesterClearance: string[],
): boolean {
  const result = db.prepare(`
    UPDATE tasks SET assignee_email = @assigneeEmail, assignees = @assignees
    WHERE id = @id
      AND status IN ('open','in_progress')
      AND ${clearanceWhere()}
  `).run({
    id,
    ...assigneeWrite(assigneeEmails),
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  });
  return result.changes > 0;
}

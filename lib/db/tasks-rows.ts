import { assigneesFromRow } from "./task-assignees";

/**
 * The task row shape and its mapping to `TaskRecord`.
 *
 * Split out of `tasks.ts` (which sits just under the file-size limit) so that
 * the query module holds queries and this one holds the record shape, the same
 * division `shared-doc-rows.ts` already uses for shared docs.
 */

export type TaskStatus = "proposed" | "open" | "in_progress" | "done" | "dismissed";
export type TaskOrigin = "circleback" | "agent" | "manual";

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  /**
   * The FIRST assignee, or null when nobody is assigned. Kept as its own field
   * (and its own column) so every chip, query and card that names one person
   * still reads one person. `assignees` is the source of truth: see
   * `assigneeWrite`, which writes both together.
   */
  assigneeEmail: string | null;
  /** Everyone assigned, in the order they were added. Empty means unassigned. */
  assignees: string[];
  sourceMeetingId: string | null;
  sourceNotePath: string | null;
  clearance: string[];
  /**
   * Canonical addresses of everyone recorded as attending the source meeting,
   * snapshotted at extraction time. Empty for a manual task, and for any
   * meeting task written before the v28 migration that `bootTasks()` has not
   * backfilled yet. Attendance is a visibility GRANT on top of clearance: see
   * `tasks-visibility.ts`.
   */
  sourceAttendees: string[];
  status: TaskStatus;
  due: string | null;
  origin: TaskOrigin;
  projectId?: string | null;
  /**
   * Who created the task, when that is known. Meeting-derived and agent-created
   * tasks have no human creator and stay null, which the lifecycle rule reads
   * as "only an admin may delete this".
   */
  createdBy: string | null;
  createdAt: string;
  /**
   * When it became done. Null while unfinished, cleared on reopen, and absent
   * on a task built by hand rather than read from a row. Optional so the insert
   * inputs, which describe work that has not happened yet, do not have to carry
   * a field that is always null for them.
   */
  completedAt?: string | null;
}

/**
 * Proposed tasks come from meeting ingestion and the agent, so they have no
 * human creator. `sourceAttendees` is optional because only the meeting path
 * has one: an agent-created task has no room full of people behind it, and
 * omitting it means the same as `[]`, no attendance grant.
 */
export type ProposedTask =
  Omit<TaskRecord, "status" | "createdBy" | "sourceAttendees" | "assignees">
  & { sourceAttendees?: string[]; assignees?: string[] };

export interface ManualTaskInput {
  title: string;
  description: string;
  assignees: string[];
  clearance: string[];
  due: string | null;
  createdBy: string;
  createdAt: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  assignee_email: string | null;
  assignees: string | null;
  source_meeting_id: string | null;
  source_note_path: string | null;
  clearance: string;
  source_attendees: string | null;
  status: TaskStatus;
  due: string | null;
  origin: TaskOrigin;
  project_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Tolerant on purpose: a malformed column reads as "no groups" / "no attendees", never a throw. */
export function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export function fromRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assigneeEmail: row.assignee_email,
    assignees: assigneesFromRow(row.assignees, row.assignee_email),
    sourceMeetingId: row.source_meeting_id,
    sourceNotePath: row.source_note_path,
    clearance: parseStringArray(row.clearance),
    sourceAttendees: parseStringArray(row.source_attendees),
    status: row.status,
    due: row.due,
    origin: row.origin,
    projectId: row.project_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  };
}

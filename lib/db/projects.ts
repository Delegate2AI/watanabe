import type { Database as DatabaseType } from "better-sqlite3";
import { getThreadOwner, type ThreadRecord } from "./threads";
import { getTaskForRequester, getForRequester, type TaskRecord } from "./tasks";
import type { ProjectRecord, NewProject, ProjectSummary, ProjectRow } from "./projects-types";

export type { ProjectRecord, NewProject, ProjectSummary } from "./projects-types";

/**
 * `projects` table access (spec 26): a project is a clearance-scoped workspace
 * grouping a user's threads and cleared tasks, with its own optional agent
 * context. DI-seam module (takes `db` first), prepared statements, named params.
 *
 * SECURITY: a project is owner-scoped AND clearance-scoped. `getProjectForRequester`
 * returns a project iff the requester owns it OR their clearance intersects the
 * project's clearance, and returns `null` for a foreign OR unknown id alike (no
 * existence oracle, model on lib/db/ownership.ts). Its thread and task lists are
 * fail-closed: they never surface a thread the viewer does not own or a task the
 * viewer is not cleared for, so a project can never widen what a viewer can see.
 */


/**
 * A written clearance must be a non-empty array of non-empty group strings.
 * `all-hands` (visible to everyone) is the string "all-hands" IN the array, so
 * an empty array is never a legitimate value: it is corruption. Parsing returns
 * `[]` for ANY invalid shape, and the read path (canSeeProject) treats `[]` as
 * "hidden from everyone but the owner" (fail closed), never as all-hands. This
 * is the fix for a corrupted clearance row silently exposing the project to
 * every requester.
 */
function isValidClearance(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((group) => typeof group === "string" && group.trim().length > 0)
  );
}

function parseClearance(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return isValidClearance(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    context: row.context,
    clearance: parseClearance(row.clearance),
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
  };
}

/**
 * True when the requester owns the project or their clearance intersects its.
 * A project whose stored clearance is empty/malformed (parsed to `[]`) is hidden
 * from everyone but its owner: we deliberately do NOT fall back to all-hands, so
 * a corrupted row fails closed instead of exposing the project to all requesters.
 */
function canSeeProject(project: ProjectRecord, email: string, clearance: string[]): boolean {
  if (project.ownerEmail.trim().toLowerCase() === email.trim().toLowerCase()) return true;
  const allowed = new Set(clearance);
  return project.clearance.some((group) => allowed.has(group));
}

export function createProject(db: DatabaseType, project: NewProject): void {
  // Defense in depth: never persist a clearance that the read path would have to
  // treat as corruption. A malformed clearance can only enter via a direct DB
  // write, never through this function.
  if (!isValidClearance(project.clearance)) {
    throw new Error("project clearance must be a non-empty array of group names");
  }
  db.prepare(`
    INSERT INTO projects (id, name, description, context, clearance, owner_email, created_at)
    VALUES (@id, @name, @description, @context, @clearance, @ownerEmail, @createdAt)
  `).run({ ...project, clearance: JSON.stringify(project.clearance) });
}

/** The raw row for `id`, or null. Internal: does NOT apply the visibility gate. */
function getRaw(db: DatabaseType, id: string): ProjectRecord | null {
  const row = db.prepare(`SELECT * FROM projects WHERE id = @id`).get({ id }) as ProjectRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * A project the requester may see (owner or clearance intersect), else null.
 * A foreign project and an unknown id both return null (no existence oracle).
 */
export function getProjectForRequester(
  db: DatabaseType,
  id: string,
  requesterEmail: string,
  requesterClearance: string[],
): ProjectRecord | null {
  const project = getRaw(db, id);
  if (!project) return null;
  return canSeeProject(project, requesterEmail, requesterClearance) ? project : null;
}

/** Every project the requester owns or is cleared for, newest first. */
export function listProjectsForRequester(
  db: DatabaseType,
  requesterEmail: string,
  requesterClearance: string[],
): ProjectRecord[] {
  const rows = db.prepare(`SELECT * FROM projects ORDER BY created_at DESC, id ASC`).all() as ProjectRow[];
  return rows.map(fromRow).filter((p) => canSeeProject(p, requesterEmail, requesterClearance));
}

/**
 * Update a project's editable fields (name/description/context), owner-scoped.
 * Returns true only when a row owned by `ownerEmail` was changed; a foreign or
 * unknown id updates zero rows and returns false.
 */
export function updateProject(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  patch: { name?: string; description?: string | null; context?: string | null },
): boolean {
  const sets: string[] = [];
  const params: Record<string, string | null> = { id, owner: ownerEmail.trim().toLowerCase() };
  if (patch.name !== undefined) { sets.push("name = @name"); params.name = patch.name; }
  if (patch.description !== undefined) { sets.push("description = @description"); params.description = patch.description; }
  if (patch.context !== undefined) { sets.push("context = @context"); params.context = patch.context; }
  if (sets.length === 0) return false;
  const info = db.prepare(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = @id AND LOWER(owner_email) = @owner`,
  ).run(params);
  return info.changes > 0;
}

/**
 * File a thread into a project. Guarded twice: the requester must be able to see
 * the project (owner or clearance) AND must own the thread (threads are
 * owner-private, so this is the only way a thread is "visible to the project's
 * clearance"). The thread_id PK enforces at-most-one-project, so re-filing moves
 * the thread. Returns false (no-op) when either guard fails.
 */
export function attachThread(
  db: DatabaseType,
  projectId: string,
  threadId: string,
  requesterEmail: string,
  requesterClearance: string[],
): boolean {
  if (!getProjectForRequester(db, projectId, requesterEmail, requesterClearance)) return false;
  const owner = getThreadOwner(db, threadId);
  if (owner === null || owner.trim().toLowerCase() !== requesterEmail.trim().toLowerCase()) return false;
  db.prepare(`
    INSERT INTO project_threads (thread_id, project_id) VALUES (@threadId, @projectId)
    ON CONFLICT(thread_id) DO UPDATE SET project_id = @projectId
  `).run({ threadId, projectId });
  return true;
}

/**
 * File a task into a project. Guarded: the requester must see the project AND
 * see the task (spec-21 visibility), AND the task's clearance must intersect the
 * project's clearance, so the project's members could actually see it. Returns
 * false when any guard fails.
 */
export function attachTask(
  db: DatabaseType,
  projectId: string,
  taskId: string,
  requesterEmail: string,
  requesterClearance: string[],
): boolean {
  const project = getProjectForRequester(db, projectId, requesterEmail, requesterClearance);
  if (!project) return false;
  const task = getTaskForRequester(db, taskId, requesterEmail, requesterClearance);
  if (!task) return false;
  // No all-hands fallback: a project with an empty/malformed clearance can hold
  // no attachments (nothing intersects an empty set), matching the fail-closed
  // read path.
  const projectGroups = new Set(project.clearance);
  const taskGroups = task.clearance.length > 0 ? task.clearance : ["all-hands"];
  if (!taskGroups.some((group) => projectGroups.has(group))) return false;
  const info = db.prepare(`UPDATE tasks SET project_id = @projectId WHERE id = @taskId`).run({ projectId, taskId });
  return info.changes > 0;
}

/**
 * The project's threads visible to `requesterEmail`: only threads the requester
 * owns (fail closed). Newest activity first.
 *
 * SECURITY: this AUTHORIZES the project itself (owner or clearance) before
 * touching its children, and returns an empty list for a foreign OR unknown
 * project id alike. Without this, a direct caller could tell a foreign project
 * apart from an unknown one whenever a viewer-visible child is attached (a
 * membership oracle); routes pre-check, but the DB API must be fail-closed too.
 */
export function listThreads(
  db: DatabaseType,
  projectId: string,
  requesterEmail: string,
  requesterClearance: string[],
): ThreadRecord[] {
  if (!getProjectForRequester(db, projectId, requesterEmail, requesterClearance)) return [];
  const rows = db.prepare(`
    SELECT t.* FROM threads t
    JOIN project_threads pt ON pt.thread_id = t.sdk_session_id
    WHERE pt.project_id = @projectId AND LOWER(t.owner_email) = @owner
    ORDER BY t.updated_at DESC
  `).all({ projectId, owner: requesterEmail.trim().toLowerCase() }) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    sdkSessionId: row.sdk_session_id as string,
    ownerEmail: row.owner_email as string,
    title: (row.title as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    dirty: row.dirty === 1,
    dreamedAt: (row.dreamed_at as string | null) ?? null,
    pinned: row.pinned === 1,
  }));
}

/** Count of the project's threads visible to the viewer (their own). Authorized. */
export function countThreads(
  db: DatabaseType,
  projectId: string,
  requesterEmail: string,
  requesterClearance: string[],
): number {
  return listThreads(db, projectId, requesterEmail, requesterClearance).length;
}

/**
 * The project's tasks visible to the viewer (spec-21 visibility), filed here.
 * Authorizes the project first (foreign and unknown ids return the same empty
 * list, no membership oracle).
 */
export function listTasks(
  db: DatabaseType,
  projectId: string,
  requesterEmail: string,
  requesterClearance: string[],
): TaskRecord[] {
  if (!getProjectForRequester(db, projectId, requesterEmail, requesterClearance)) return [];
  return getForRequester(db, requesterEmail, requesterClearance).filter(
    (task) => taskProjectId(db, task.id) === projectId,
  );
}

/** Count of the project's tasks visible to the viewer. Authorized. */
export function countTasks(
  db: DatabaseType,
  projectId: string,
  requesterEmail: string,
  requesterClearance: string[],
): number {
  return listTasks(db, projectId, requesterEmail, requesterClearance).length;
}

/** The project_id a task is filed under, or null. Internal helper. */
function taskProjectId(db: DatabaseType, taskId: string): string | null {
  const row = db.prepare(`SELECT project_id FROM tasks WHERE id = @taskId`).get({ taskId }) as
    | { project_id: string | null }
    | undefined;
  return row?.project_id ?? null;
}

/**
 * Cleared projects with viewer-scoped counts and a last-activity timestamp: the
 * newest of the viewer's own thread updates, the viewer's newest attached task,
 * and the project's creation. Task activity is included so a freshly filed task
 * bumps the card even when no thread moved. Backs the `/projects` card grid.
 */
export function listProjectSummariesForRequester(
  db: DatabaseType,
  requesterEmail: string,
  requesterClearance: string[],
): ProjectSummary[] {
  return listProjectsForRequester(db, requesterEmail, requesterClearance).map((project) => {
    const threads = listThreads(db, project.id, requesterEmail, requesterClearance);
    const tasks = listTasks(db, project.id, requesterEmail, requesterClearance);
    const timestamps = [
      project.createdAt,
      ...threads.map((thread) => thread.updatedAt),
      ...tasks.map((task) => task.createdAt),
    ];
    return {
      project,
      threadCount: threads.length,
      taskCount: tasks.length,
      lastActivity: timestamps.reduce((latest, current) => (current > latest ? current : latest)),
    };
  });
}

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { loadAliasIndex, type AliasIndex } from "@/lib/authority/aliases";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { unfilteredVaultRoot } from "@/lib/repo";
import { attendeesFromNote } from "./attendees";
import { isTasksEnabled } from "./config";

/**
 * Boot-time hook for the tasks subsystem (spec 21), the orchestrator's
 * counterpart to `bootPackages()` / `bootMeetings()`.
 *
 * Unlike packages and meetings, tasks have NO independent async job queue to
 * drain: meeting-derived tasks are extracted synchronously inside meeting
 * ingestion (`extractTasksForMeeting`, called from `lib/meetings/runner.ts`),
 * and a task's lifecycle states (`proposed`/`open`/`done`/`dismissed`) are
 * user-facing review states, not job states. Nothing is ever left mid-flight
 * in a `processing` state that a restart would need to requeue: if a pod dies
 * mid-ingest, recovery is owned by `bootMeetings()` requeuing the stuck
 * meeting, which re-runs task extraction (and `taskExists()` makes that
 * re-run idempotent). So there is genuinely nothing for `bootTasks()` to
 * drain.
 *
 * What it does own is the one-off attendee backfill below.
 *
 * Contract, matching the sibling boots:
 *  - No-op when `isTasksEnabled()` is off, so flag-off leaves boot unchanged.
 *  - Never throws: any failure is logged and swallowed rather than crashing
 *    server startup.
 */
export function bootTasks(overrides?: Partial<TaskBootDependencies>): void {
  try {
    if (!isTasksEnabled()) return;
    backfillSourceAttendees({
      db: overrides?.db ?? getDb(),
      aliases: overrides?.aliases ?? loadAliasIndex(),
      readNote: overrides?.readNote ?? readNoteFromVault,
    });
  } catch (err) {
    log.error("bootTasks failed unexpectedly", { error: String(err) });
  }
}

export interface TaskBootDependencies {
  db: DatabaseType;
  aliases: AliasIndex;
  /** Reads a vault-relative or `docs/`-prefixed note path. Throws if unreadable. */
  readNote: (notePath: string) => string;
}

interface BackfillRow {
  id: string;
  source_note_path: string;
}

/**
 * Stamp the attendee list onto meeting tasks written before the v28 migration.
 *
 * Extraction is idempotent (`taskExists` short-circuits a re-run), so a task
 * already in the table would never pick up its attendees on its own. Without
 * this pass, every action item that exists today stays invisible to the people
 * who were in the meeting, which is the bug the column was added to fix.
 *
 * Cheap and self-limiting: only rows whose list is still empty are considered,
 * each distinct note is read once, and the writes go in one transaction, so the
 * pass costs a single indexless scan on every boot after the first. A note that
 * has been deleted, moved, or written with no `attendees:` field leaves its rows
 * at `[]`, which is clearance-only, today's behaviour rather than a regression.
 */
function backfillSourceAttendees({ db, aliases, readNote }: TaskBootDependencies): void {
  const rows = db.prepare(`
    SELECT id, source_note_path FROM tasks
    WHERE source_attendees = '[]' AND source_note_path IS NOT NULL
  `).all() as BackfillRow[];
  if (rows.length === 0) return;

  const byNote = new Map<string, string[]>();
  const updates: { id: string; attendees: string }[] = [];
  for (const row of rows) {
    let attendees = byNote.get(row.source_note_path);
    if (attendees === undefined) {
      attendees = readAttendees(row.source_note_path, aliases, readNote);
      byNote.set(row.source_note_path, attendees);
    }
    if (attendees.length > 0) updates.push({ id: row.id, attendees: JSON.stringify(attendees) });
  }
  if (updates.length === 0) return;

  const update = db.prepare("UPDATE tasks SET source_attendees = @attendees WHERE id = @id");
  db.transaction((batch: typeof updates) => {
    for (const item of batch) update.run(item);
  })(updates);
  log.info("backfilled task attendees", { tasks: updates.length, notes: byNote.size });
}

function readAttendees(
  notePath: string,
  aliases: AliasIndex,
  readNote: TaskBootDependencies["readNote"],
): string[] {
  try {
    return attendeesFromNote(readNote(notePath), aliases);
  } catch (err) {
    log.error("task attendee backfill could not read the source note", { notePath, error: String(err) });
    return [];
  }
}

/**
 * The unfiltered checkout, not a clearance projection: this runs at boot with no
 * requester, and the point is to read a note that no projection would show to
 * the attendee it is about to grant.
 */
function readNoteFromVault(notePath: string): string {
  const relative = notePath.startsWith("docs/") ? notePath.slice("docs/".length) : notePath;
  return readFileSync(path.join(unfilteredVaultRoot(), relative), "utf8");
}

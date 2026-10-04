import type { Database as DatabaseType } from "better-sqlite3";
import { aliasIndex } from "@/lib/authority/aliases";
import type { TaskRecord } from "@/lib/db/tasks";
import type { MeetingListItem } from "@/lib/meetings/list";
import { isTaskOverdue, todayFrom } from "./overdue";
import { buildRoster, normalizeEmail, readFeeds, type RosterFeeds } from "./roster";
import type { Person } from "./types";

/**
 * What each person is doing, rolled up from the same two feeds `/tasks` and
 * `/meetings` already show the same viewer. Nothing is materialized: this
 * composes on read, so there is no rollup table that can drift.
 */

export type ActivityWindow = "7d" | "30d" | "all";

export interface PersonActivity {
  person: Person;
  tasks: {
    open: number;              // status open + in_progress
    overdue: number;           // due < today, status not done
    proposed: number;          // in their inbox, not yet accepted
    completed: number;         // status done, all time
  };
  meetings: {
    inWindow: number;
    latest: { title: string; date: string; href: string } | null;
  };
  lastActivityAt: string | null;   // max(task createdAt, meeting date)
}

/** Days of history each window covers. `all` has no lower bound at all. */
const WINDOW_DAYS: Record<ActivityWindow, number | null> = { "7d": 7, "30d": 30, all: null };

const DAY_MS = 24 * 60 * 60 * 1000;

interface Bucket {
  open: number;
  overdue: number;
  proposed: number;
  completed: number;
  meetingsInWindow: number;
  latest: PersonActivity["meetings"]["latest"];
  lastActivityAt: string | null;
  lastActivityMs: number;
}

function emptyBucket(): Bucket {
  return {
    open: 0,
    overdue: 0,
    proposed: 0,
    completed: 0,
    meetingsInWindow: 0,
    latest: null,
    lastActivityAt: null,
    lastActivityMs: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Both feeds carry timestamps written by other systems: a task's `createdAt` is
 * a full ISO instant, while a meeting's `date` is whatever the note's
 * frontmatter holds and may be a bare `YYYY-MM-DD`. Parsing rather than
 * comparing strings keeps a bare date from sorting under an instant on the same
 * day, and hands back null for anything unreadable so it is simply not counted.
 */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Lower bound of the window in epoch milliseconds, or null when unbounded. */
function windowStart(window: ActivityWindow, now: Date): number | null {
  const days = WINDOW_DAYS[window] ?? null;
  return days === null ? null : now.getTime() - days * DAY_MS;
}

function withinWindow(value: string | null | undefined, start: number | null): boolean {
  const instant = instantOf(value);
  if (instant === null) return false;
  return start === null || instant >= start;
}

function noteActivity(bucket: Bucket, value: string | null): void {
  const instant = instantOf(value);
  if (instant === null || instant <= bucket.lastActivityMs) return;
  bucket.lastActivityMs = instant;
  bucket.lastActivityAt = value;
}

function countTask(bucket: Bucket, task: TaskRecord, today: string): void {
  // Every task count ignores the window; only Meetings follows the range. Work
  // outstanding right now is the question this surface answers, and Completed
  // counts what the person page lists, all time, so the two cannot disagree.
  if (task.status === "open" || task.status === "in_progress") bucket.open += 1;
  if (task.status === "proposed") bucket.proposed += 1;
  // Shared with the person page rather than restated here: a task this column
  // counts as overdue has to appear in that page's Overdue group.
  if (isTaskOverdue(task, today)) bucket.overdue += 1;
  if (task.status === "done") bucket.completed += 1;
  noteActivity(bucket, task.createdAt);
  // Finishing a task is activity too, and it is the only signal a person who
  // closed old work leaves behind.
  noteActivity(bucket, task.completedAt ?? null);
}

function countMeeting(bucket: Bucket, meeting: MeetingListItem, start: number | null): void {
  if (withinWindow(meeting.date, start)) bucket.meetingsInWindow += 1;
  // `latest` ignores the window for the same reason `lastActivityAt` does: it
  // answers "when did I last see this person" and a window of zero meetings is
  // more legible next to the last one that happened than next to nothing.
  const instant = instantOf(meeting.date);
  const latest = instantOf(bucket.latest?.date);
  if (instant !== null && (latest === null || instant > latest)) {
    bucket.latest = { title: meeting.title, date: meeting.date, href: meeting.href };
  }
  noteActivity(bucket, meeting.date);
}

function bucketsFor(feeds: RosterFeeds, today: string, start: number | null): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  // One read for the whole roll-up. Buckets are keyed by the CANONICAL address,
  // matching `buildRoster`, so a person's two addresses land in one bucket and
  // the row shows all of their work rather than half of it twice.
  const aliases = aliasIndex();
  const bucketFor = (rawEmail: string): Bucket | null => {
    const email = normalizeEmail(rawEmail, aliases);
    if (!email) return null;
    const existing = buckets.get(email);
    if (existing) return existing;
    const created = emptyBucket();
    buckets.set(email, created);
    return created;
  };
  for (const task of feeds.tasks) {
    // A task with no assignee belongs to nobody and is counted for nobody. It
    // is the unassigned inbox, which /tasks already surfaces.
    if (task.assigneeEmail === null) continue;
    const bucket = bucketFor(task.assigneeEmail);
    if (bucket) countTask(bucket, task, today);
  }
  for (const meeting of feeds.meetings) {
    // Deduped per meeting: `attendees:` is frontmatter written from a calendar
    // invite, so the same person can appear twice as `Ken@x` and `ken@x `.
    // Counting each entry would credit one meeting two or three times, and the
    // person page (which lists the meeting once) would then contradict the
    // count on the list page.
    // Wrapped, not passed by reference: `map` would hand the index in as the
    // alias argument, silently turning canonicalization off right here.
    const attendees = new Set(meeting.attendees.map((a) => normalizeEmail(a, aliases)));
    for (const attendee of attendees) {
      const bucket = bucketFor(attendee);
      if (bucket) countMeeting(bucket, meeting, start);
    }
  }
  return buckets;
}

/**
 * One row per person on the roster, including people whose every count is zero:
 * an idle person is a finding, not an absence, so they are kept rather than
 * dropped.
 *
 * Never throws. With both feeds' flags off this is the roster with all-zero
 * rows, not an error page.
 */
export function personActivity(
  db: DatabaseType,
  viewerEmail: string,
  viewerClearance: string[],
  window: ActivityWindow,
): PersonActivity[] {
  // Derived once, so every row is measured against the same boundary even if
  // the roll-up straddles midnight, and so a test can pin it with fake timers.
  const now = new Date();
  try {
    const feeds = readFeeds(db, viewerEmail, viewerClearance);
    const roster = buildRoster(db, viewerEmail, viewerClearance, feeds);
    const start = windowStart(window, now);
    const today = todayFrom(now);
    const buckets = bucketsFor(feeds, today, start);
    return roster.map((person) => {
      const bucket = buckets.get(person.email) ?? emptyBucket();
      return {
        person,
        tasks: {
          open: bucket.open,
          overdue: bucket.overdue,
          proposed: bucket.proposed,
          completed: bucket.completed,
        },
        meetings: { inWindow: bucket.meetingsInWindow, latest: bucket.latest },
        lastActivityAt: bucket.lastActivityAt,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[people] failed to roll up activity: ${message}`);
    return [];
  }
}

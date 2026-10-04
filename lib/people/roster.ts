import type { Database as DatabaseType } from "better-sqlite3";
import { aliasIndex, canonicalEmail, type AliasIndex } from "@/lib/authority/aliases";
import { getBoardTasks, type TaskRecord } from "@/lib/db/tasks";
import { isMeetingsEnabled } from "@/lib/meetings/config";
import { listMeetingNotes, type MeetingListItem } from "@/lib/meetings/list";
import { isTasksEnabled } from "@/lib/tasks/config";
import { isPeopleEnabled } from "./config";
import { resolvePeople } from "./resolve";
import { loadPeople } from "./store";
import type { Directory, Person } from "./types";

/**
 * Who belongs on the people surface, and the two feeds that answer it.
 *
 * Clearance is never re-implemented here. `getBoardTasks` filters in SQL and
 * `listMeetingNotes` reads the caller's clearance-scoped vault projection, so
 * work outside the viewer's clearance contributes nobody to the union and no
 * counts to anybody. Their absence is the boundary (spec 19).
 *
 * The directory is the deliberate exception, and it is NOT a clearance
 * boundary: `access/people.yaml` is the company directory, self-populated when
 * someone signs in, so a colleague who exists is listed for every viewer even
 * when every task and meeting of theirs is restricted. What that discloses is
 * that a coworker exists, which SSO already tells you; their work stays absent
 * and their row reads all zeros. Do not mistake a directory-only row for
 * evidence that the viewer may see anything of that person's.
 */

/** The two reads the roster and the activity roll-up share. */
export interface RosterFeeds {
  tasks: TaskRecord[];
  meetings: MeetingListItem[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The one spelling of an address every feed is joined on. Tasks store a
 * lower-cased assignee, but a meeting's `attendees:` is whatever the calendar
 * invite carried, so the same person arrives as `Ken@x` from one feed and
 * `ken@x ` from the other.
 *
 * Casing was only half of it. The same human also arrives under two DIFFERENT
 * addresses: the one their portal identity and tasks use, and the personal one
 * on a calendar invite. Folding those is exactly what `access/aliases.yaml`
 * exists for, and tasks, meetings and clearance resolution have gone through it
 * all along; this surface was the one that did not, so it drew one person as two
 * rows, each holding half their work. `aliasIndex()` is mtime-cached, so the
 * default argument costs a `statSync` and no parse.
 *
 * Pass `aliases` explicitly in a loop, and NEVER hand this straight to
 * `Array.map`: the callback's index argument would land in that parameter.
 */
export function normalizeEmail(email: unknown, aliases: AliasIndex = aliasIndex()): string {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return normalized ? canonicalEmail(normalized, aliases) : "";
}

/**
 * Reads both feeds once, each behind its own flag.
 *
 * The surface deliberately does not depend on TASKS_ENABLED or
 * MEETINGS_ENABLED: a feed that is off contributes nothing and the page
 * degrades to whatever is actually running, rather than vanishing.
 *
 * Never throws. This joins three never-throws readers and must not become the
 * one place a bad meeting note takes out a page.
 */
export function readFeeds(
  db: DatabaseType,
  viewerEmail: string,
  viewerClearance: string[],
): RosterFeeds {
  let tasks: TaskRecord[] = [];
  let meetings: MeetingListItem[] = [];
  try {
    if (isTasksEnabled()) tasks = getBoardTasks(db, normalizeEmail(viewerEmail), viewerClearance);
  } catch (error) {
    console.error(`[people] failed to read the task feed: ${message(error)}`);
  }
  try {
    if (isMeetingsEnabled()) meetings = listMeetingNotes(viewerClearance);
  } catch (error) {
    console.error(`[people] failed to read the meeting feed: ${message(error)}`);
  }
  return { tasks, meetings };
}

function collectEmails(directory: Directory, feeds: RosterFeeds): Set<string> {
  const emails = new Set<string>();
  // Read once for the whole union rather than per address.
  const aliases = aliasIndex();
  const add = (raw: unknown) => {
    const email = normalizeEmail(raw, aliases);
    if (email) emails.add(email);
  };
  // The directory self-populates on SSO sign-in, so anyone who has never opened
  // watanabe is missing from it. Those are exactly the people a leader wants to
  // see, which is why the roster is a union rather than just the directory.
  // It is empty when PEOPLE_ENABLED is off, because that flag promises no
  // `access/people.yaml` is read at all. See the read site in `buildRoster`.
  for (const email of Object.keys(directory)) add(email);
  for (const task of feeds.tasks) add(task.assigneeEmail);
  for (const meeting of feeds.meetings) for (const attendee of meeting.attendees) add(attendee);
  return emails;
}

/**
 * Everyone the viewer can see, sorted by display name.
 *
 * `feeds` exists so the activity roll-up can pass the reads it already made
 * instead of paying for them twice. It is optional and last, so the spec's
 * three-argument signature still holds for every other caller.
 */
export function buildRoster(
  db: DatabaseType,
  viewerEmail: string,
  viewerClearance: string[],
  feeds?: RosterFeeds,
): Person[] {
  try {
    const resolvedFeeds = feeds ?? readFeeds(db, viewerEmail, viewerClearance);
    // Read once and handed to `resolvePeople`, so building the union and naming
    // it do not cost two reads of the same file. The union itself is collected
    // whether or not PEOPLE_ENABLED is on: that flag decides how a person is
    // named, not whether they exist.
    // Gated because `lib/people/config.ts` promises that with PEOPLE_ENABLED off
    // no `access/people.yaml` is read or written. Honouring that costs only the
    // directory-only rows: anyone with a task or a meeting still appears, named
    // by `resolvePeople`'s existing flag-off path (their raw address).
    const directory = isPeopleEnabled() ? loadPeople() : {};
    const emails = collectEmails(directory, resolvedFeeds);
    // One batch, not a per-email resolver in a loop.
    const people = resolvePeople([...emails], {
      viewerEmail: normalizeEmail(viewerEmail),
      directory,
    });
    return Object.values(people).sort(
      (left, right) => left.name.localeCompare(right.name) || left.email.localeCompare(right.email),
    );
  } catch (error) {
    console.error(`[people] failed to build the roster: ${message(error)}`);
    return [];
  }
}

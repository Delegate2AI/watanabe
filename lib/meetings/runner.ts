import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { loadAliasIndex, type AliasIndex } from "@/lib/authority/aliases";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { loadGroups, type Groups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { getMeetingPayload } from "@/lib/db/meeting-payloads";
import {
  getIngestedMeeting,
  getMeetingJob,
  markMeetingDone,
  markMeetingError,
  markMeetingProcessing,
  upsertIngestedMeeting,
} from "@/lib/db/meetings";
import { log } from "@/lib/log";
import { isTasksEnabled } from "@/lib/tasks/config";
import { canonicalAttendees } from "@/lib/tasks/attendees";
import { extractTasksForMeeting, type MeetingTaskContext } from "@/lib/tasks/runner";
import { deriveMeetingVisibility } from "./clearance";
import { configuredCirclebackClient, type Meeting } from "./circleback";
import { isMeetingsEnabled } from "./config";
import { buildNote, normalizeMeeting, slugFor } from "./normalize";
import { meetingFromWebhookPayload } from "./webhook";
import { writeMeetingNote, type MeetingWrite } from "./writer";
import { getConfig } from "@/lib/config";

/**
 * Resolve a meeting, stored webhook payload first and the Circleback API only
 * as a fallback.
 *
 * Order matters and is not just an optimization. A meeting that arrived by
 * webhook was recorded by some other workspace member, and this deployment's
 * token cannot read those: asking the API for one would fail with a permission
 * error, which is the exact wall the webhook exists to route around. So a
 * stored payload is authoritative, and the API call is reserved for meetings
 * the poll itself discovered.
 */
export async function resolveMeeting(db: DatabaseType, id: string): Promise<Meeting> {
  const stored = getMeetingPayload(db, id);
  if (stored) return meetingFromWebhookPayload(JSON.parse(stored.payload));
  return configuredCirclebackClient().getMeeting(id);
}

interface RunnerDependencies {
  db: DatabaseType;
  getMeeting: (id: string) => Promise<Meeting>;
  loadGroups: () => Groups;
  loadAliases: () => AliasIndex;
  normalize: (meeting: Meeting) => Promise<string>;
  writeNote: (input: MeetingWrite) => Promise<void>;
  extractTasks: (id: string, context: MeetingTaskContext) => Promise<void>;
  now: () => string;
}

function defaults(): RunnerDependencies {
  const db = getDb();
  return {
    db,
    getMeeting: (id) => resolveMeeting(db, id),
    loadGroups,
    loadAliases: loadAliasIndex,
    normalize: normalizeMeeting,
    writeNote: writeMeetingNote,
    extractTasks: (id, context) => extractTasksForMeeting(id, context),
    now: () => new Date().toISOString(),
  };
}

/**
 * Action items are deliberately excluded: they land minutes after the meeting
 * and keep changing as Circleback revises them, and the note body does not
 * carry them. Including them would rewrite an unchanged note on every poll.
 * Task extraction runs on the unchanged path too, so late items are still
 * picked up.
 */
function sourceHash(meeting: Meeting): string {
  const hashed: Record<string, unknown> = { ...meeting };
  delete hashed.actionItems;
  return createHash("sha256").update(JSON.stringify(hashed)).digest("hex");
}

export async function runMeetingJob(id: string, dependencies?: RunnerDependencies): Promise<void> {
  const deps = dependencies ?? defaults();
  try {
    if (!isMeetingsEnabled()) return;
    const job = getMeetingJob(deps.db, id);
    if (!job || job.state !== "queued") return;
    if (!isAuthorityEnabled()) {
      log.error("meeting ingestion refused because authority is disabled", { meetingId: id });
      markMeetingError(deps.db, id, "AUTHORITY_ENABLED is required", deps.now());
      return;
    }

    markMeetingProcessing(deps.db, id, deps.now());
    const meeting = await deps.getMeeting(id);
    const hash = sourceHash(meeting);
    const prior = getIngestedMeeting(deps.db, id);
    if (prior?.sourceHash === hash) {
      markMeetingDone(deps.db, id, deps.now());
      if (isTasksEnabled()) {
        await deps.extractTasks(id, {
          notePath: prior.notePath,
          visibility: deriveMeetingVisibility(meeting.attendees, deps.loadGroups(), deps.loadAliases()),
          attendees: canonicalAttendees(meeting.attendees.map((a) => a.email), deps.loadAliases()),
          actionItems: meeting.actionItems,
        });
      }
      return;
    }

    const visibility = deriveMeetingVisibility(meeting.attendees, deps.loadGroups(), deps.loadAliases());
    const body = await deps.normalize(meeting);
    const notePath = prior?.notePath ?? slugFor(meeting);
    await deps.writeNote({
      meetingId: id,
      path: notePath,
      content: buildNote(meeting, body, visibility),
      title: meeting.title,
      authorName: getConfig().git.botName,
      authorEmail: getConfig().git.botEmail,
    });
    upsertIngestedMeeting(deps.db, {
      meetingId: id,
      notePath,
      sourceHash: hash,
      ingestedAt: deps.now(),
    });
    markMeetingDone(deps.db, id, deps.now());
    if (isTasksEnabled()) {
      await deps.extractTasks(id, {
        notePath,
        visibility,
        attendees: canonicalAttendees(meeting.attendees.map((a) => a.email), deps.loadAliases()),
        actionItems: meeting.actionItems,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("meeting ingestion failed", { meetingId: id, error: message });
    try {
      markMeetingError(deps.db, id, message, deps.now());
    } catch (dbError) {
      log.error("meeting ingestion error recording failed", { meetingId: id, error: String(dbError) });
    }
  }
}

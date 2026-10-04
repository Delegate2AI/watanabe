import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { listQueuedMeetingIds, requeueStuckMeetings } from "@/lib/db/meetings";
import { enqueue, __resetJobQueueFamilyForTests } from "@/lib/jobs/queue";
import { runMeetingJob } from "./runner";

const MEETING_FAMILY = "meetings";

export function enqueueMeeting(
  meetingId: string,
  run: (id: string) => Promise<void> = runMeetingJob,
): void {
  enqueue(MEETING_FAMILY, meetingId, run);
}

export function bootMeetings(db: DatabaseType = getDb()): void {
  requeueStuckMeetings(db);
  for (const id of listQueuedMeetingIds(db)) enqueueMeeting(id);
}

export function __resetMeetingsQueueForTests(): void {
  __resetJobQueueFamilyForTests(MEETING_FAMILY);
}

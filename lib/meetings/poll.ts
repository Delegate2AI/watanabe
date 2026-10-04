import type { Database as DatabaseType } from "better-sqlite3";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { getDb } from "@/lib/db/client";
import { getIngestCursor, insertMeetingJob, setIngestCursor } from "@/lib/db/meetings";
import { configuredCirclebackClient } from "./circleback";
import { isMeetingsEnabled, meetingNameFilter } from "./config";
import { enqueueMeeting } from "./queue";

interface PollDependencies {
  db: DatabaseType;
  listNewMeetings: (cursor: string | null, nameFilter: string | null) => Promise<{ ids: string[]; cursor: string }>;
  enqueue: (id: string) => void;
}

function defaults(): PollDependencies {
  return {
    db: getDb(),
    listNewMeetings: (cursor, nameFilter) => configuredCirclebackClient().listNewMeetings(cursor, nameFilter),
    enqueue: enqueueMeeting,
  };
}

export async function pollMeetings(dependencies?: PollDependencies): Promise<{ detail: string }> {
  const deps = dependencies ?? defaults();
  if (!isMeetingsEnabled()) return { detail: "meetings disabled" };
  if (!isAuthorityEnabled()) return { detail: "authority disabled" };

  const result = await deps.listNewMeetings(getIngestCursor(deps.db), meetingNameFilter());
  for (const id of result.ids) {
    insertMeetingJob(deps.db, id);
    deps.enqueue(id);
  }
  if (result.cursor) setIngestCursor(deps.db, result.cursor);
  return { detail: `enqueued ${result.ids.length} meetings` };
}

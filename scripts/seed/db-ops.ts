/**
 * Seeds the operational tables the old seeder left empty: the meeting ingest
 * ledger, the package upload queue, and the per-user activity cursor.
 *
 * Meetings are file-backed, so `lib/meetings/list.ts` renders straight from the
 * generated vault whether or not these rows exist. What the rows add is the
 * INGEST side: `ingested_meetings` is what makes the poller idempotent, and the
 * `meetings` job table is what the queue and the boot-time recovery sweep read.
 * Seeding both means the meetings surface has a plausible history instead of
 * looking like every note arrived from nowhere.
 *
 * Packages cover every lifecycle state, including one left in `processing` so
 * `requeueStuckProcessing()` has something to recover on the next boot.
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { markSeen } from "@/lib/db/activity";
import {
  insertMeetingJob,
  markMeetingDone,
  markMeetingError,
  markMeetingProcessing,
  setIngestCursor,
  upsertIngestedMeeting,
} from "@/lib/db/meetings";
import { insertPackage, markFailed, markNoChanges, markProcessing, markSubmitted } from "@/lib/db/packages";
import { MEETING_IDS } from "./notes/meetings";
import { ME, iso } from "./roster";

const MARIA = "maria.chen@example.com";
const DEVON = "devon.brooks@example.com";

/** A stand-in for the source-payload hash the real poller stores. */
function fakeHash(id: string): string {
  return `demo-${id.replace(/[^a-z0-9]/g, "")}`;
}

const INGESTED = [
  { id: MEETING_IDS.riskGuild, day: 2 },
  { id: MEETING_IDS.researchSync, day: 6 },
  { id: MEETING_IDS.standup, day: 10 },
  { id: MEETING_IDS.tokenomics, day: 15 },
  { id: MEETING_IDS.execReview, day: 17 },
  { id: MEETING_IDS.onboardingRetro, day: 21 },
];

const PACKAGES = [
  { id: "pkg-tier-deck", owner: ME, name: "tier-deck-export.zip", day: 12, outcome: "submitted" as const },
  { id: "pkg-research-notes", owner: MARIA, name: "research-notes-batch.zip", day: 14, outcome: "no_changes" as const },
  { id: "pkg-legacy-import", owner: DEVON, name: "legacy-wiki-import.zip", day: 16, outcome: "failed" as const },
  { id: "pkg-glossary-terms", owner: ME, name: "glossary-terms.zip", day: 22, outcome: "queued" as const },
  { id: "pkg-handbook-assets", owner: DEVON, name: "handbook-assets.zip", day: 22, outcome: "processing" as const },
];

export function seedOps(db: DatabaseType): void {
  for (const m of INGESTED) {
    insertMeetingJob(db, m.id, iso(m.day, 10));
    markMeetingProcessing(db, m.id, iso(m.day, 10));
    markMeetingDone(db, m.id, iso(m.day, 11));
    upsertIngestedMeeting(db, {
      meetingId: m.id,
      notePath: `meetings/${m.id}.md`,
      sourceHash: fakeHash(m.id),
      ingestedAt: iso(m.day, 11),
    });
  }
  // One meeting that failed to ingest: the error surface needs a row too.
  insertMeetingJob(db, "2026-07-23-partner-call", iso(23, 10));
  markMeetingError(db, "2026-07-23-partner-call", "attendee could not be resolved to a known member", iso(23, 10));
  setIngestCursor(db, iso(23, 10));

  for (const p of PACKAGES) {
    insertPackage(db, { id: p.id, ownerEmail: p.owner, name: p.name }, iso(p.day));
    if (p.outcome === "queued") continue;
    markProcessing(db, p.id, `pkg-thread-${p.id}`, iso(p.day, 10));
    if (p.outcome === "processing") continue;
    if (p.outcome === "submitted") {
      markSubmitted(db, p.id, {
        mrUrl: "https://gitlab.example.com/acme/kb/-/merge_requests/42",
        report: "3 notes staged, 1 skipped (no frontmatter).",
      }, iso(p.day, 11));
    }
    if (p.outcome === "no_changes") {
      markNoChanges(db, p.id, "Every note in the package already matches the vault.", iso(p.day, 11));
    }
    if (p.outcome === "failed") {
      markFailed(db, p.id, {
        error: "unsupported entry type in archive",
        report: "Stopped after 2 of 40 entries.",
      }, iso(p.day, 11));
    }
  }

  // Leave the cursor behind the newest content so the activity bell has an
  // unread count on first load instead of an empty panel.
  markSeen(db, ME, iso(14, 12));
}

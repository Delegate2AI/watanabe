import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { loadAliasIndex, type AliasIndex } from "@/lib/authority/aliases";
import { loadGroups, type Groups } from "@/lib/authority/groups";
import { readVisibility } from "@/lib/authority/visibility";
import { readFrontmatter } from "@/lib/index/frontmatter";
import { getDb } from "@/lib/db/client";
import { getIngestedMeeting } from "@/lib/db/meetings";
import { insertProposed, taskExists } from "@/lib/db/tasks";
import { log } from "@/lib/log";
import { configuredCirclebackClient, type ActionItem } from "@/lib/meetings/circleback";
import { vaultRoot } from "@/lib/repo";
import { attendeesFromNote } from "./attendees";
import { isTasksEnabled } from "./config";
import { resolveAssignee } from "./resolve";
import { seedFromMeeting, type RawTaskItem } from "./seed";

export interface MeetingTaskContext {
  notePath: string;
  visibility: string[];
  /**
   * Canonical addresses of everyone who attended, stamped onto each extracted
   * task so the people in the meeting can see and act on its action items even
   * when the derived clearance does not cover them. See `tasks-visibility.ts`.
   */
  attendees: string[];
  actionItems: ActionItem[];
}

export interface TaskRunnerDependencies {
  db: DatabaseType;
  seed: (actionItems: ActionItem[]) => RawTaskItem[];
  resolve: (item: RawTaskItem, groups: Groups, aliases: AliasIndex) => string | null;
  loadGroups: () => Groups;
  loadAliases: () => AliasIndex;
  fetchActionItems: (meetingId: string) => Promise<ActionItem[]>;
  now: () => string;
}

function defaults(): TaskRunnerDependencies {
  return {
    db: getDb(),
    seed: seedFromMeeting,
    resolve: resolveAssignee,
    loadGroups,
    loadAliases: loadAliasIndex,
    fetchActionItems: async (meetingId) => (await configuredCirclebackClient().getMeeting(meetingId)).actionItems,
    now: () => new Date().toISOString(),
  };
}

function sourceId(meetingId: string): string {
  return meetingId.startsWith("circleback:") ? meetingId : `circleback:${meetingId}`;
}

/**
 * Keyed on Circleback's own action item id. Keying on the title would create a
 * duplicate every time an upstream edit reworded it, and would have been
 * outright unstable when titles came from a model.
 */
export function taskId(meetingId: string, externalId: string): string {
  const hash = createHash("sha256").update(`${sourceId(meetingId)}\n${externalId.trim()}`).digest("hex");
  return `task-${hash.slice(0, 24)}`;
}

async function loadContext(
  db: DatabaseType,
  meetingId: string,
  fetchActionItems: (meetingId: string) => Promise<ActionItem[]>,
): Promise<MeetingTaskContext | null> {
  const bareId = meetingId.replace(/^circleback:/, "");
  const ingested = getIngestedMeeting(db, bareId);
  if (!ingested) return null;
  const actionItems = await fetchActionItems(bareId);
  const relative = ingested.notePath.startsWith("docs/")
    ? ingested.notePath.slice("docs/".length)
    : ingested.notePath;
  try {
    const contents = await readFile(path.join(vaultRoot(), relative), "utf8");
    const frontmatter = readFrontmatter(contents);
    const attendees = attendeesFromNote(contents, loadAliasIndex());
    const declared = frontmatter.status === "unparseable" ? undefined : frontmatter.fields.visibility;
    // Fail closed for task inheritance: a note that is unparseable or carries NO
    // explicit visibility field yields no visibility ([]), not readVisibility's
    // all-hands default. Otherwise a task seeded from an unmarked note would be
    // fully public. An explicit visibility (even ["all-hands"]) is honored below.
    if (declared === undefined || declared === null || declared === "") {
      return { notePath: ingested.notePath, visibility: [], attendees, actionItems };
    }
    const visibility = readVisibility(contents);
    return {
      notePath: ingested.notePath,
      visibility: visibility === "unparseable" || visibility.length === 0 ? [] : [...visibility],
      attendees,
      actionItems,
    };
  } catch (error) {
    log.error("task source visibility could not be read", { meetingId, error: String(error) });
    return { notePath: ingested.notePath, visibility: [], attendees: [], actionItems };
  }
}

export async function extractTasksForMeeting(
  meetingId: string,
  suppliedContext?: MeetingTaskContext,
  dependencies?: TaskRunnerDependencies,
): Promise<void> {
  if (!isTasksEnabled()) return;
  const deps = dependencies ?? defaults();
  try {
    const context = suppliedContext ?? await loadContext(deps.db, meetingId, deps.fetchActionItems);
    if (!context) return;
    const inheritedClearance = context.visibility.length > 0 ? [...context.visibility] : [];
    const groups = deps.loadGroups();
    const aliases = deps.loadAliases();
    for (const item of deps.seed(context.actionItems)) {
      try {
        const id = taskId(meetingId, item.externalId);
        if (taskExists(deps.db, id)) continue;
        insertProposed(deps.db, {
          id,
          title: item.title,
          description: item.description,
          assigneeEmail: deps.resolve(item, groups, aliases),
          sourceMeetingId: sourceId(meetingId),
          sourceNotePath: context.notePath,
          clearance: inheritedClearance,
          sourceAttendees: context.attendees,
          // Circleback action items carry no due date; a task gets one when a
          // human sets it, never from a guess.
          due: null,
          origin: "circleback",
          createdAt: deps.now(),
        });
      } catch (error) {
        log.error("task action item extraction failed", { meetingId, error: String(error) });
      }
    }
  } catch (error) {
    log.error("task extraction failed", { meetingId, error: String(error) });
  }
}

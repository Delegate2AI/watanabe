import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { readVisibility } from "@/lib/authority/visibility";
import { meetingCandidatesSince, sharedDocCandidatesSince, taskCommentCandidatesSince } from "@/lib/db/activity";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { getForRequester } from "@/lib/db/tasks";
import { requesterKey } from "@/lib/db/tasks-visibility";
import { accessFor } from "@/lib/shared-docs/access";
import { extractMentions } from "@/lib/shared-docs/mentions";
import { isMeetingsEnabled } from "@/lib/meetings/config";
import { isTasksEnabled, isTaskCommentsEnabled } from "@/lib/tasks/config";
import { isSharedDocsEnabled, isDocAccessRequestsEnabled } from "@/lib/shared-docs/config";
import { listPendingForOwner } from "@/lib/db/doc-access-requests";
import { vaultRootFor } from "@/lib/repo";
import { isActivityEnabled } from "./config";

export interface ActivityItem {
  id: string;
  title: string;
  href: string;
  createdAt: string;
  visibility: "all-hands" | "restricted";
  group?: string;
}

export interface ActivityFeed {
  tasks: ActivityItem[];
  meetings: ActivityItem[];
  sharedDocs: ActivityItem[];
  accessRequests: ActivityItem[];
  taskComments: ActivityItem[];
  unreadCount: number;
}

const EMPTY_FEED: ActivityFeed = {
  tasks: [],
  meetings: [],
  sharedDocs: [],
  accessRequests: [],
  taskComments: [],
  unreadCount: 0,
};

function groupLabel(group: string): string {
  return group.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function visibilityFor(groups: string[]): Pick<ActivityItem, "visibility" | "group"> {
  const restricted = groups.find((group) => group !== "all-hands");
  return restricted
    ? { visibility: "restricted", group: groupLabel(restricted) }
    : { visibility: "all-hands" };
}

function noteRelativePath(notePath: string): string | null {
  if (!notePath.startsWith("docs/") || notePath.includes("\\")) return null;
  const relative = notePath.slice("docs/".length);
  return path.posix.normalize(relative) === relative && !relative.startsWith("../")
    ? relative
    : null;
}

function meetingItem(root: string, candidate: { id: string; notePath: string; createdAt: string }): ActivityItem | null {
  const relative = noteRelativePath(candidate.notePath);
  if (!relative) return null;
  const absolute = path.join(root, ...relative.split("/"));
  if (!existsSync(absolute)) return null;
  const rawVisibility = readVisibility(readFileSync(absolute, "utf8"));
  const groups = Array.isArray(rawVisibility) ? rawVisibility : [];
  const title = path.posix.basename(relative, ".md").split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const route = relative.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
  return {
    id: candidate.id,
    title,
    href: `/kb/${route}`,
    createdAt: candidate.createdAt,
    ...visibilityFor(groups),
  };
}

export function newSince(
  db: DatabaseType,
  email: string,
  clearance: string[],
  cursor: string,
): ActivityFeed {
  if (!isActivityEnabled()) return { ...EMPTY_FEED };
  const normalizedEmail = email.trim().toLowerCase();
  const tasks = isTasksEnabled()
    ? getForRequester(db, normalizedEmail, clearance, ["proposed"])
      .filter((task) => task.createdAt > cursor)
      .map((task) => ({
        id: task.id,
        title: task.title,
        href: "/tasks",
        createdAt: task.createdAt,
        ...visibilityFor(task.clearance),
      }))
    : [];
  const root = isMeetingsEnabled() ? vaultRootFor(clearance) : "";
  const meetings = isMeetingsEnabled()
    ? meetingCandidatesSince(db, cursor)
      .map((candidate) => meetingItem(root, candidate))
      .filter((item): item is ActivityItem => item !== null)
    : [];
  // One clearance value for both halves: the candidate query and the per-doc
  // re-check. Resolving it twice, or letting them diverge, is what produces a
  // feed row that 404s when clicked.
  const docClearance = isSharedDocsEnabled() ? shareClearanceFor(normalizedEmail) : [];
  const sharedDocs = isSharedDocsEnabled()
    ? sharedDocCandidatesSince(db, normalizedEmail, cursor, docClearance)
      .filter((candidate) => accessFor(db, candidate.id, normalizedEmail, docClearance) !== "none")
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        href: `/docs/${encodeURIComponent(candidate.id)}`,
        createdAt: candidate.createdAt,
        visibility: "restricted" as const,
        group: "Shared with you",
      }))
    : [];
  // Owner-only by construction: the query joins on `shared_docs.owner_email`,
  // so an ask on someone else's document cannot reach this feed. The row names
  // the document, never the requester's message, which is for the panel.
  const accessRequests = isDocAccessRequestsEnabled()
    ? listPendingForOwner(db, normalizedEmail, cursor).map((request) => ({
      id: request.id,
      title: request.docTitle,
      href: `/docs/${encodeURIComponent(request.docId)}`,
      createdAt: request.createdAt,
      visibility: "restricted" as const,
      group: "Access requested",
    }))
    : [];
  // Involvement, not clearance, decides what reaches you here. Clearance alone
  // would put every comment on the whole board into everyone's What's New and
  // bury the meetings and shared docs beside it.
  const taskComments = isTasksEnabled() && isTaskCommentsEnabled()
    ? taskCommentCandidatesSince(db, normalizedEmail, requesterKey(normalizedEmail), clearance, cursor)
      .filter((candidate) =>
        candidate.isAssignee
        || candidate.isTaskCreator
        || candidate.viewerParticipates
        || extractMentions(candidate.body, [normalizedEmail]).length > 0)
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.taskTitle,
        href: `/tasks/${encodeURIComponent(candidate.taskId)}`,
        createdAt: candidate.createdAt,
        ...visibilityFor(candidate.taskClearance),
      }))
    : [];
  return {
    tasks,
    meetings,
    sharedDocs,
    accessRequests,
    taskComments,
    unreadCount:
      tasks.length + meetings.length + sharedDocs.length + accessRequests.length + taskComments.length,
  };
}

import { headers } from "next/headers";
import { ListChecks } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { PageHeader } from "@/components/kit/page-header";
import { TasksSurface } from "./tasks-surface";
import { resolveIdentity } from "@/lib/identity/resolve";
import { assignableMembers, loadGroups } from "@/lib/authority/groups";
import { can, isRolesEnabled } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { getBoardTasks } from "@/lib/db/tasks";
import { requesterKey } from "@/lib/db/tasks-visibility";
import { countsForTasks } from "@/lib/db/task-comments";
import { isTaskCommentsEnabled, isTasksEnabled } from "@/lib/tasks/config";
import { resolvePeople } from "@/lib/people/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = {
  icon: ListChecks,
  eyebrow: "Tasks",
  title: "From your meetings",
  description:
    "Action items Watanabe pulled from meetings you attended or are cleared for. Proposed items wait for you to accept before they count.",
};

/**
 * The Tasks surface (spec 21 + 2026-07-14 team board). Flag-off it renders the
 * identical spec-21 scaffold, so the byte-path is unchanged. On: a shared team
 * board (broad, clearance-scoped) plus the existing narrow List, with manual
 * task creation and assign/reassign.
 */
export default async function TasksPage() {
  if (!isTasksEnabled()) {
    return <RouteScaffold {...HEADER} spec="spec 21" flag="TASKS_ENABLED" />;
  }

  const identity = await resolveIdentity(await headers());
  const groups = loadGroups();
  const members = assignableMembers(groups);
  // One query backs every scope: `boardVisibleWhere()` is `clearanceWhere()` and
  // `visibleWhere()` is that plus the assignee half, so this set is a strict
  // superset of what the Mine and Unassigned scopes filter out of it.
  const tasks = identity ? getBoardTasks(getDb(), identity.email, identity.clearance) : [];
  // Exactly the caller's own clearance, admin or not. `POST /api/tasks`
  // recomputes `resolveClearance()` and rejects a group the creator is not in
  // (the task design requires membership), so offering an admin every group
  // here would only produce options that always fail on submit.
  const myGroups = identity ? identity.clearance : [];
  const canTriage = identity ? !isRolesEnabled() || can(identity.email, "write") : false;
  // Canonical: `assignee_email` is stored canonical everywhere, and the client
  // compares the two directly to split Mine from Unassigned. A session under an
  // alias would match neither and its own tasks would leave the list.
  const actorEmail = identity ? requesterKey(identity.email) : "";
  // <PersonChip> takes an already-resolved person: the resolver reads the
  // directory from disk, so it runs here, never inside the client island. One
  // batch covers every assignee on either list plus every pickable member.
  const people = resolvePeople(
    [...members, ...tasks.map((task) => task.assigneeEmail)]
      .filter((email): email is string => typeof email === "string" && email !== ""),
    identity ? { viewerEmail: identity.email } : {},
  );
  // One statement for every card on the page. A per-card count query would be
  // an N+1 across the whole board.
  const commentCounts = isTaskCommentsEnabled()
    ? countsForTasks(getDb(), tasks.map((task) => task.id))
    : {};

  return (
    <div className="mx-auto max-w-6xl px-8 pb-14 pt-16">
      <PageHeader
        icon={HEADER.icon}
        eyebrow={HEADER.eyebrow}
        title="Team tasks"
        description="Plan, assign, and track the team's work. Meeting action items land in the Inbox; add your own with New task."
      />
      <TasksSurface
        tasks={tasks}
        members={members}
        people={people}
        commentCounts={commentCounts}
        myGroups={myGroups}
        actorEmail={actorEmail}
        viewerClearance={myGroups}
        canTriage={canTriage}
      />
    </div>
  );
}

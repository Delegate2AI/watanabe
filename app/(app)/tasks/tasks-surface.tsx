"use client";

import { useState } from "react";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import type { TaskRecord } from "@/lib/db/tasks";
import { inScope, isLive, isProposed, isTeamScope, needsMyTriage, type Scope } from "@/lib/tasks/scope";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { TaskScopeBar } from "./task-scope-bar";
import { TriageStrip } from "./triage-strip";
import type { Person } from "@/lib/people/types";

/**
 * The Tasks surface (spec 21, the 2026-07-14 team board, and the 2026-08-23
 * layout rework). Scope and layout are two controls over one piece of state
 * here, so switching layout no longer resets what you were looking at.
 */
export function TasksSurface({
  tasks,
  members,
  people,
  commentCounts = {},
  myGroups,
  actorEmail,
  viewerClearance,
  canTriage,
}: {
  /** Everything the viewer is cleared for. See `getBoardTasks`. */
  tasks: TaskRecord[];
  members: string[];
  /** Resolved server-side, keyed by normalized email. See `resolvePeople`. */
  people: Record<string, Person>;
  /** Absent key means no comments. See `countsForTasks`. */
  commentCounts?: Record<string, number>;
  myGroups: string[];
  actorEmail: string;
  /** The viewer's own groups, for deciding whether a task's source note is reachable. */
  viewerClearance: string[];
  canTriage: boolean;
}) {
  const [scope, setScope] = useState<Scope>("mine");
  const [layout, setLayout] = useState<"list" | "board">("list");

  const visible = tasks.filter((task) => task.status !== "dismissed");
  // Triage ignores the scope control and follows the sidebar badge instead, so
  // the two never disagree about how much is waiting on you.
  const proposed = visible.filter((task) => needsMyTriage(task, actorEmail));
  const live = visible.filter(isLive);
  // A group narrows Team, so the Team count has to narrow with it or it names a
  // different set than the cards below it.
  const teamScope: Scope = isTeamScope(scope) ? scope : "team";
  const counts = {
    mine: live.filter((task) => inScope(task, "mine", actorEmail)).length,
    unassigned: live.filter((task) => inScope(task, "unassigned", actorEmail)).length,
    team: live.filter((task) => inScope(task, teamScope, actorEmail)).length,
  };
  // Done stays in the set both layouts receive, folded away, and out of the
  // counts above, so every number describes exactly one visible group.
  const shown = visible.filter((task) => !isProposed(task) && inScope(task, scope, actorEmail));

  return (
    <div>
      <TriageStrip
        tasks={proposed}
        members={members}
        people={people}
        commentCounts={commentCounts}
        actorEmail={actorEmail}
        viewerClearance={viewerClearance}
        canTriage={canTriage}
      />
      <div className="mb-6">
        <TaskScopeBar
          scope={scope}
          onScope={setScope}
          layout={layout}
          onLayout={setLayout}
          counts={counts}
          myGroups={myGroups}
          action={<NewTaskDialog members={members} people={people} myGroups={myGroups} />}
        />
      </div>
      {layout === "board" ? (
        <TaskBoard
          tasks={shown}
          members={members}
          people={people}
          commentCounts={commentCounts}
          canTriage={canTriage}
        />
      ) : (
        <TaskList
          tasks={shown}
          members={members}
          people={people}
          commentCounts={commentCounts}
          actorEmail={actorEmail}
          viewerClearance={viewerClearance}
          canTriage={canTriage}
        />
      )}
    </div>
  );
}

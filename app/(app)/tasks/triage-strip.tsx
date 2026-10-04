"use client";

import { ChevronRight } from "lucide-react";
import type { TaskRecord } from "@/lib/db/tasks";
import type { Person } from "@/lib/people/types";
import { TaskListCard } from "./task-list-card";

export function TriageStrip({
  tasks,
  members,
  people,
  commentCounts,
  actorEmail,
  viewerClearance,
  canTriage,
}: {
  /** Proposed tasks only, already unscoped by the caller. See D2. */
  tasks: TaskRecord[];
  members: string[];
  people: Record<string, Person>;
  commentCounts?: Record<string, number>;
  actorEmail: string;
  viewerClearance: string[];
  canTriage: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <details className="group mb-6 rounded-xl border border-line bg-surface">
      <summary className="flex list-none cursor-pointer select-none items-center gap-2 px-5 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-90" aria-hidden />
        Inbox
        <span className="text-ink-muted">
          {tasks.length} {tasks.length === 1 ? "item needs" : "items need"} triage
        </span>
      </summary>
      <ul className="flex flex-col gap-3 border-t border-line p-5">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskListCard
              task={task}
              members={members}
              people={people}
              commentCount={commentCounts?.[task.id] ?? 0}
              actorEmail={actorEmail}
              viewerClearance={viewerClearance}
              canTriage={canTriage}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}

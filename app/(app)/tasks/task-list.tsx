"use client";

import { ChevronRight } from "lucide-react";
import type { TaskRecord } from "@/lib/db/tasks";
import { TaskListCard } from "./task-list-card";
import type { Person } from "@/lib/people/types";

const COUNT = "ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-ink-muted";
const HEADER = "mb-3 flex items-center gap-1 text-sm font-medium text-ink";
const SUMMARY = `${HEADER} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;
// Every section reserves the chevron slot, so only Done's is drawn and all
// three headers still share one left edge.
const CHEVRON = "size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-90";

type CardListProps = {
  tasks: TaskRecord[];
  members: string[];
  people: Record<string, Person>;
  commentCounts: Record<string, number>;
  actorEmail: string;
  viewerClearance: string[];
  canTriage: boolean;
};

function CardList({ tasks, members, people, commentCounts, actorEmail, viewerClearance, canTriage }: CardListProps) {
  return (
    <ul className="grid gap-3">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskListCard task={task} members={members} people={people} commentCount={commentCounts[task.id] ?? 0} actorEmail={actorEmail} viewerClearance={viewerClearance} canTriage={canTriage} />
        </li>
      ))}
    </ul>
  );
}

export function TaskList({
  tasks,
  members,
  people,
  commentCounts = {},
  actorEmail,
  viewerClearance,
  canTriage,
}: {
  /** Already scoped by the caller, and never containing proposed tasks. */
  tasks: TaskRecord[];
  members: string[];
  people: Record<string, Person>;
  commentCounts?: Record<string, number>;
  actorEmail: string;
  viewerClearance: string[];
  canTriage: boolean;
}) {
  if (tasks.length === 0) return <p className="text-sm text-ink-muted">No tasks in this view.</p>;

  const todo = tasks.filter((task) => task.status === "open");
  const inProgress = tasks.filter((task) => task.status === "in_progress");
  const done = tasks.filter((task) => task.status === "done");
  const cardListProps = { members, people, commentCounts, actorEmail, viewerClearance, canTriage };

  return (
    <div className="grid gap-6">
      {todo.length > 0 && (
        <section>
          <h2 className={HEADER}>
            <span className="size-4 shrink-0" aria-hidden />
            To do<span className={COUNT}>{todo.length}</span>
          </h2>
          <CardList tasks={todo} {...cardListProps} />
        </section>
      )}
      {inProgress.length > 0 && (
        <section>
          <h2 className={HEADER}>
            <span className="size-4 shrink-0" aria-hidden />
            In progress<span className={COUNT}>{inProgress.length}</span>
          </h2>
          <CardList tasks={inProgress} {...cardListProps} />
        </section>
      )}
      {done.length > 0 && (
        <details className="group">
          <summary className={SUMMARY}>
            <ChevronRight className={CHEVRON} aria-hidden />
            Done<span className={COUNT}>{done.length}</span>
          </summary>
          <div className="mt-3">
            <CardList tasks={done} {...cardListProps} />
          </div>
        </details>
      )}
    </div>
  );
}

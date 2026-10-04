"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, MessageSquare, UserRound } from "lucide-react";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { vaultDocHref } from "@/lib/index/web-links";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { messageForBody } from "@/lib/errors/messages";
import { DueLabel } from "@/components/tasks/due-label";
import { AssigneeChips } from "@/components/tasks/assignee";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { canReadSourceNote } from "@/lib/tasks/source-note";
import { groupLabel } from "@/lib/tasks/scope";
import type { Person } from "@/lib/people/types";

const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: "Proposed", open: "Open", in_progress: "In progress", done: "Done", dismissed: "Dismissed",
};
const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50";
const SECONDARY = "rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2 disabled:opacity-50";

function sourceHref(notePath: string): string {
  return vaultDocHref(notePath.replace(/^docs\//, ""));
}

export function TaskListCard({
  task,
  members,
  people,
  commentCount = 0,
  actorEmail,
  viewerClearance,
  canTriage,
}: {
  task: TaskRecord;
  members: string[];
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people: Record<string, Person>;
  commentCount?: number;
  actorEmail: string;
  /** The viewer's own groups. See `canReadSourceNote`. */
  viewerClearance: string[];
  canTriage: boolean;
}) {
  const router = useRouter();
  const [assignees, setAssignees] = useState<string[]>(task.assignees);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const restrictedGroup = task.clearance.find((group) => group !== "all-hands");
  const isDone = task.status === "done";
  const canComplete = (task.status === "open" || task.status === "in_progress") && task.assignees.includes(actorEmail);

  function act(body: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(messageForBody(result));
        return;
      }
      router.refresh();
    });
  }

  return (
    <article className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {canComplete || isDone ? (
            <button type="button" role="checkbox" aria-checked={isDone} aria-label={isDone ? "Completed" : "Mark complete"} disabled={pending || isDone} onClick={() => act({ action: "complete" })} className={isDone ? "mt-0.5 grid size-5 shrink-0 place-items-center rounded border border-accent bg-accent text-white" : "mt-0.5 grid size-5 shrink-0 place-items-center rounded border border-line text-transparent hover:border-accent"}>
              <Check className="size-3.5" aria-hidden />
            </button>
          ) : (
            <span aria-hidden className="mt-0.5 size-5 shrink-0" />
          )}
          <div className="min-w-0">
            <h3 className={isDone ? "font-semibold text-ink-muted line-through" : "font-semibold text-ink"}>
              <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="hover:underline">{task.title}</Link>
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{task.description}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">{STATUS_LABELS[task.status]}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        {task.sourceNotePath && canReadSourceNote(task.clearance, viewerClearance)
          ? <Link className="font-medium hover:underline" href={sourceHref(task.sourceNotePath)}>Source meeting</Link>
          : null}
        {restrictedGroup ? <VisibilityChip visibility="restricted" group={groupLabel(restrictedGroup)} /> : null}
        <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" aria-hidden /><AssigneeChips emails={task.assignees} people={people} emptyLabel={isDone ? "Unassigned" : "Needs triage"} /></span>
        {task.due ? <DueLabel due={task.due} className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden /></DueLabel> : null}
        {commentCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted" aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}>
            <MessageSquare className="size-3.5" aria-hidden />
            {commentCount}
          </span>
        ) : null}
      </div>
      {task.status === "proposed" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canTriage ? (
            <>
              <AssigneePicker
                id={`list-assignee-${task.id}`}
                label="Assignee"
                members={members}
                people={people}
                value={assignees}
                onChange={setAssignees}
                disabled={pending}
              />
            </>
          ) : (
            <AssigneeChips emails={task.assignees} people={people} />
          )}
          <button type="button" disabled={pending || !canTriage} onClick={() => act({ action: "accept", ...(assignees.length > 0 ? { assignees } : {}) })} className={PRIMARY}>Accept</button>
          <button type="button" disabled={pending || !canTriage} onClick={() => act({ action: "dismiss" })} className={SECONDARY}>Dismiss</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-warn">{error}</p> : null}
    </article>
  );
}

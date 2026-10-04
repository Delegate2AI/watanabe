"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { messageForBody } from "@/lib/errors/messages";
import { DueLabel } from "@/components/tasks/due-label";
import { AssigneeChips } from "@/components/tasks/assignee";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import type { Person } from "@/lib/people/types";

const ACTIVE_ORDER: TaskStatus[] = ["open", "in_progress", "done"];
const SECONDARY = "rounded-md border border-line px-2.5 py-1 text-xs text-ink hover:bg-surface-2 disabled:opacity-50";
const PRIMARY = "rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-ink disabled:opacity-50";

export function TaskBoardCard({
  task,
  members,
  people,
  commentCount = 0,
  canTriage,
  onChanged,
}: {
  task: TaskRecord;
  members: string[];
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people: Record<string, Person>;
  commentCount?: number;
  canTriage: boolean;
  onChanged: () => void;
}) {
  const [assignees, setAssignees] = useState<string[]>(task.assignees);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isInbox = task.status === "proposed";
  const index = ACTIVE_ORDER.indexOf(task.status);
  const movable = !isInbox && index >= 0;
  const settled = task.status === "done" || task.status === "dismissed";
  const assigneeLocked = (isInbox && !canTriage) || settled;

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
      onChanged();
    });
  }

  function selectAssignees(next: string[]) {
    setAssignees(next);
    // Outside the Inbox there is no Accept button to submit against, so the
    // picker IS the write. An empty list is not sent: `reassign` has no way to
    // clear an assignee, and the route refuses one that names nobody.
    if (!isInbox && next.length > 0) {
      act({ action: "reassign", assignees: next });
    }
  }

  /**
   * The keyboard equivalent of dragging the card. Native HTML5 drag and drop
   * fires no keyboard events, so without this the board would be pointer-only.
   */
  function moveByKey(event: KeyboardEvent<HTMLElement>) {
    // Only when the card itself holds focus. The assignee select owns its own
    // arrow keys, and stealing them there would change status instead of value.
    if (event.target !== event.currentTarget || pending) return;
    const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!offset) return;
    const next = ACTIVE_ORDER[index + offset];
    if (!next) return;
    event.preventDefault();
    act({ action: "move", status: next });
  }

  return (
    <article
      {...(movable
        ? { tabIndex: 0, onKeyDown: moveByKey, "aria-describedby": `move-help-${task.id}` }
        : {})}
      className={`rounded-lg border border-line bg-surface p-3${movable ? " cursor-grab focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing" : ""}`}
    >
      <h3 className="text-sm font-medium text-ink">
        <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="hover:underline">{task.title}</Link>
      </h3>
      {task.description ? <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{task.description}</p> : null}
      <div className="mt-2">
        {assigneeLocked ? (
          <AssigneeChips emails={task.assignees} people={people} emptyLabel={settled ? "Unassigned" : "Needs triage"} />
        ) : (
          <AssigneePicker
            id={`assignee-${task.id}`}
            label="Assignee"
            members={members}
            people={people}
            value={assignees}
            onChange={selectAssignees}
            disabled={pending}
          />
        )}
      </div>
      {task.due ? <p className="mt-2 text-xs text-ink-muted"><DueLabel due={task.due} prefix="Due " /></p> : null}
      {commentCount > 0 ? (
        <p className="mt-2">
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted" aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}>
            <MessageSquare className="size-3.5" aria-hidden />
            {commentCount}
          </span>
        </p>
      ) : null}
      {isInbox ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={pending || !canTriage}
            onClick={() => act({ action: "accept", ...(assignees.length > 0 ? { assignees } : {}) })}
            className={PRIMARY}
          >Accept</button>
          <button type="button" disabled={pending || !canTriage} onClick={() => act({ action: "dismiss" })} className={SECONDARY}>Dismiss</button>
        </div>
      ) : null}
      {movable ? (
        <p id={`move-help-${task.id}`} className="sr-only">
          Drag this card to another column, or press the left or right arrow key to move it.
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-warn">{error}</p> : null}
    </article>
  );
}

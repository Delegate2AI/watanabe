"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskAction, TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { messageForBody } from "@/lib/errors/messages";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import type { Person } from "@/lib/people/types";

const PRIMARY = "rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50";
const SECONDARY = "rounded-md border border-line px-3 py-2 text-sm text-ink hover:bg-surface-2 disabled:opacity-50";
const STATUS_LABELS: Record<Extract<TaskStatus, "open" | "in_progress" | "done">, string> = {
  open: "To do",
  in_progress: "In progress",
  done: "Done",
};

export function TaskActions({
  task,
  members,
  people,
  allowedActions,
}: {
  task: TaskRecord;
  members: string[];
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people: Record<string, Person>;
  allowedActions: TaskAction[];
}) {
  const router = useRouter();
  const [assignees, setAssignees] = useState<string[]>(task.assignees);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const allowed = new Set(allowedActions);

  function act(body: Record<string, unknown>, leave = false) {
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
      if (leave) router.push("/tasks");
      else router.refresh();
    });
  }

  const moveTargets = (["open", "in_progress", "done"] as const).filter((status) => status !== task.status);

  // Nothing to submit when the picker still holds exactly what the task holds,
  // in the same order: the write would be a no-op the route reports as changed.
  const sameAssignees = assignees.length === task.assignees.length
    && assignees.every((email, index) => email === task.assignees[index]);

  return (
    <div className="mt-8 border-t border-line pt-6">
      <h2 className="mb-3 text-sm font-semibold text-ink">Actions</h2>
      {task.status === "proposed" && allowed.has("accept") ? (
        <div className="mb-3 flex max-w-xl flex-wrap gap-2">
          <AssigneePicker
            id={`detail-assignee-${task.id}`}
            label="Assignee"
            members={members}
            people={people}
            value={assignees}
            onChange={setAssignees}
            disabled={pending}
            className="min-w-52"
          />
          <button type="button" disabled={pending} onClick={() => act({ action: "accept", ...(assignees.length > 0 ? { assignees } : {}) })} className={PRIMARY}>Accept</button>
        </div>
      ) : null}
      {allowed.has("reassign") ? (
        <div className="mb-3 flex max-w-xl flex-wrap gap-2">
          <AssigneePicker
            id={`detail-reassign-${task.id}`}
            label="Reassign"
            members={members}
            people={people}
            value={assignees}
            onChange={setAssignees}
            disabled={pending}
            className="min-w-52"
          />
          <button type="button" disabled={pending || assignees.length === 0 || sameAssignees} onClick={() => act({ action: "reassign", assignees })} className={SECONDARY}>Reassign</button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {allowed.has("complete") ? <button type="button" disabled={pending} onClick={() => act({ action: "complete" })} className={PRIMARY}>Complete</button> : null}
        {allowed.has("dismiss") ? <button type="button" disabled={pending} onClick={() => act({ action: "dismiss" }, true)} className={SECONDARY}>Dismiss</button> : null}
        {allowed.has("move") ? moveTargets.map((status) => <button key={status} type="button" disabled={pending} onClick={() => act({ action: "move", status })} className={SECONDARY}>Move to {STATUS_LABELS[status]}</button>) : null}
        {allowed.has("delete") ? <button type="button" disabled={pending} onClick={() => act({ action: "delete" }, true)} className={SECONDARY}>Delete</button> : null}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-warn">{error}</p> : null}
    </div>
  );
}

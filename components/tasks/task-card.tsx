"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, MessageSquare, UserRound } from "lucide-react";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { vaultDocHref } from "@/lib/index/web-links";
import { taskChatSeed } from "@/lib/tasks/chat-seed";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { messageForBody } from "@/lib/errors/messages";
import { DueLabel } from "@/components/tasks/due-label";
import { AssigneeChips } from "@/components/tasks/assignee";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import type { Person } from "@/lib/people/types";

/**
 * A meeting note lives in the vault under `docs/meetings/...`, so it is viewed
 * on the KB route, not a (nonexistent) `/meetings/<slug>` detail page. Strip the
 * `docs/` vault prefix and build the `/kb/<slug>` href, matching how the
 * meetings list links each note (lib/meetings/list.ts).
 */
function sourceHref(notePath: string): string {
  return vaultDocHref(notePath.replace(/^docs\//, ""));
}

function groupLabel(group: string): string {
  return group.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: "Proposed",
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

// The app's primary action is the green accent; secondary is a bordered chip.
// (Matches NewProjectButton / artifact-editor. This component previously used
// shadcn tokens like `bg-primary` that this theme never defines, so Accept
// rendered with no fill.)
const PRIMARY_BTN =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2 disabled:opacity-50";

export function TaskCard({
  task,
  members = [],
  people = {},
  assigneeName,
  actorEmail,
  onUpdated,
}: {
  task: TaskRecord;
  members?: string[];
  /** Canonical, so it compares against a stored `assigneeEmail`. Absent means
   * the caller cannot say who is looking, and no task is offered as completable. */
  actorEmail?: string;
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people?: Record<string, Person>;
  /**
   * The assignee's display name for the chat seed. Resolved on the server for
   * the same reason: the seed text is built here, in the browser.
   */
  assigneeName?: string;
  onUpdated?: (id: string, status: TaskStatus) => void;
}) {
  const router = useRouter();
  const [assignees, setAssignees] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const restrictedGroup = task.clearance.find((group) => group !== "all-hands");
  const visibility = restrictedGroup ? "restricted" : "all-hands";
  // A tracker-style checkbox stands in for the old "Complete" button. Only the
  // assignee can complete (`canTransition`), so only they are offered the box;
  // a done task shows the filled check to everyone.
  const canComplete = (task.status === "open" || task.status === "in_progress")
    && actorEmail !== undefined && task.assignees.includes(actorEmail);
  const hasCheckbox = canComplete || task.status === "done";
  const isDone = task.status === "done";

  function act(action: "accept" | "dismiss" | "complete" | "assign") {
    setError(null);
    startTransition(async () => {
      const body = action === "assign" ? { action, assignees } : { action };
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
      const status = action === "accept" ? "open" : action === "complete" ? "done"
        : action === "dismiss" ? "dismissed" : task.status;
      onUpdated?.(task.id, status);
      // Re-render the server component so the card reflects the new status.
      // Without this the (fixed) `task` prop keeps showing "Proposed" with the
      // Accept/Dismiss buttons, and a second click hits an already-transitioned
      // task and fails with "invalid task transition".
      router.refresh();
    });
  }

  function startChat() {
    const id = globalThis.crypto?.randomUUID?.() ?? String(task.id);
    router.push(`/chat/${id}?q=${encodeURIComponent(taskChatSeed(task, { assigneeName }))}`);
  }

  return (
    <article className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {hasCheckbox ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={isDone}
              aria-label={isDone ? "Completed" : "Mark complete"}
              disabled={pending || isDone}
              onClick={() => act("complete")}
              className={
                isDone
                  ? "mt-0.5 grid size-5 shrink-0 place-items-center rounded border border-accent bg-accent text-white"
                  : "mt-0.5 grid size-5 shrink-0 place-items-center rounded border border-line text-transparent hover:border-accent disabled:opacity-50"
              }
            >
              <Check className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0">
            <h3 className={isDone ? "font-semibold text-ink-muted line-through" : "font-semibold text-ink"}>
              {task.title}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">{task.description}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">
          {STATUS_LABELS[task.status]}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        {task.sourceNotePath ? (
          <Link className="font-medium hover:underline" href={sourceHref(task.sourceNotePath)}>
            Source meeting
          </Link>
        ) : null}
        <VisibilityChip
          visibility={visibility}
          group={restrictedGroup ? groupLabel(restrictedGroup) : undefined}
        />
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3.5" aria-hidden />
          <AssigneeChips emails={task.assignees} people={people} />
        </span>
        {task.due ? (
          <DueLabel due={task.due} className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5" aria-hidden />
          </DueLabel>
        ) : null}
      </div>

      {task.status === "proposed" && task.assigneeEmail ? (
        <div className="mt-4 flex gap-2">
          <button type="button" disabled={pending} onClick={() => act("accept")} className={PRIMARY_BTN}>Accept</button>
          <button type="button" disabled={pending} onClick={() => act("dismiss")} className={SECONDARY_BTN}>Dismiss</button>
        </div>
      ) : task.assigneeEmail === null && task.status === "proposed" ? (
        <div className="mt-4 flex gap-2">
          <AssigneePicker
            id={`assign-${task.id}`}
            label="Assign to a team member"
            members={members}
            people={people}
            value={assignees}
            onChange={setAssignees}
            disabled={pending}
          />
          <button type="button" disabled={pending || assignees.length === 0} onClick={() => act("assign")} className={PRIMARY_BTN}>Assign</button>
        </div>
      ) : null}
      <div className="mt-3">
        <button
          type="button"
          onClick={startChat}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          Discuss in chat
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-warn">{error}</p> : null}
    </article>
  );
}

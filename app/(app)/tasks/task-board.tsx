"use client";

import { useState, type DragEvent } from "react";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { messageForBody } from "@/lib/errors/messages";
import { TaskBoardCard } from "./task-board-card";
import type { Person } from "@/lib/people/types";

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "open", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/**
 * Presentational board: scope lives entirely in tasks-surface.tsx, so `tasks`
 * arrives already filtered and never contains proposed tasks (spec D2, D3).
 */
export function TaskBoard({
  tasks,
  members,
  people,
  commentCounts = {},
  canTriage,
}: {
  tasks: TaskRecord[];
  members: string[];
  people: Record<string, Person>;
  /** Absent key means no comments. See `countsForTasks`. */
  commentCounts?: Record<string, number>;
  canTriage: boolean;
}) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(id: string, status: TaskStatus) {
    setError(null);
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", status }),
    });
    if (!response.ok) {
      // A card that snaps back with no explanation reads as a broken board.
      // The move buttons used to carry this message; the drop has to now.
      const result = await response.json().catch(() => null);
      setError(messageForBody(result));
      return;
    }
    router.refresh();
  }

  function startDrag(event: DragEvent<HTMLLIElement>, id: string) {
    setDragId(id);
    // A drag carrying no data is not a valid drag: the browser refuses every
    // drop and the card silently snaps back. React state alone is not enough.
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
  }

  function allowDrop(event: DragEvent<HTMLElement>) {
    // Both dragenter and dragover have to be cancelled for a column to accept a
    // card. Cancelling only dragover leaves the drop refused in Chrome.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function renderCard(task: TaskRecord) {
    return (
      // Mid-drag the card's contents leave hit testing. Chrome refuses a drop
      // that lands on a form control, and every card carries an assignee
      // select, so without this most drops silently do nothing.
      <li
        key={task.id}
        draggable
        onDragStart={(event) => startDrag(event, task.id)}
        onDragEnd={() => setDragId(null)}
        className={dragId ? `[&>*]:pointer-events-none${dragId === task.id ? " opacity-50" : ""}` : undefined}
      >
        <TaskBoardCard
          task={task}
          members={members}
          people={people}
          commentCount={commentCounts[task.id] ?? 0}
          canTriage={canTriage}
          onChanged={() => router.refresh()}
        />
      </li>
    );
  }

  return (
    <>
      {error ? <p role="alert" className="mb-3 text-xs text-warn">{error}</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const items = tasks.filter((task) => task.status === column.id);
          function onDrop(event: DragEvent<HTMLElement>) {
            event.preventDefault();
            const id = dragId || event.dataTransfer.getData("text/plain");
            if (id) void move(id, column.id);
            setDragId(null);
          }
          return (
            <section
              key={column.id}
              role="region"
              aria-label={column.label}
              onDragEnter={allowDrop}
              onDragOver={allowDrop}
              onDrop={onDrop}
              className="rounded-xl border border-line bg-surface-2/40 p-3"
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-ink">{column.label}</h2>
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-ink-muted">{items.length}</span>
              </header>
              {column.id === "done" && items.length > 0 ? (
                <details className="group">
                  <summary className="flex list-none cursor-pointer items-center gap-1 px-1 text-xs text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                    Show {items.length === 1 ? "the finished task" : "finished tasks"}
                  </summary>
                  <ul className="mt-2 grid gap-2">{items.map(renderCard)}</ul>
                </details>
              ) : (
                <>
                  <ul className="grid gap-2">{items.map(renderCard)}</ul>
                  {items.length === 0 ? <p className="px-1 text-xs text-ink-muted">Empty</p> : null}
                </>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

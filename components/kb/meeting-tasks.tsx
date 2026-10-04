import Link from "next/link";
import { ListChecks } from "lucide-react";
import type { TaskStatus } from "@/lib/db/tasks";

/**
 * The "Action items" panel on a meeting note (spec
 * 2026-08-17-kb-task-links-design), patterned on `backlinks.tsx`: the live
 * tasks this meeting produced, each linking to its detail page. Read-only;
 * acting on a task happens on `/tasks/<id>`, which carries the lifecycle
 * guards and comments.
 *
 * This panel and the normalizer's prose `## Action items` section will not
 * always agree: the prose is what was said, this is what is now true. That is
 * the point of the panel, not a bug. Renders nothing when there is nothing to
 * show, so a non-meeting note (or a meeting with no extracted tasks) is
 * byte-identical to before.
 */

export interface MeetingTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeEmail: string | null;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: "Proposed", open: "Open", in_progress: "In progress", done: "Done", dismissed: "Dismissed",
};

export function MeetingTasks({ tasks }: { tasks: MeetingTaskItem[] }) {
  if (tasks.length === 0) return null;
  return (
    <section aria-label="Action items" className="mt-8 border-t border-line-soft pt-4">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <ListChecks className="size-3" aria-hidden />
        Action items
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            <Link
              href={`/tasks/${encodeURIComponent(task.id)}`}
              className="text-[13px] text-accent hover:underline"
            >
              {task.title}
            </Link>
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
              {STATUS_LABELS[task.status]}
            </span>
            <span className="truncate text-[12px] text-ink-faint">
              {task.assigneeEmail ?? "Unassigned"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

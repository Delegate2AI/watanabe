import Link from "next/link";
import { MessageSquare, ListChecks } from "lucide-react";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

export interface ProjectCardData {
  id: string;
  name: string;
  clearance: string[];
  threadCount: number;
  taskCount: number;
  lastActivity: string;
}

function groupLabel(group: string): string {
  return group.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * `Active 3 days ago`, with the exact instant one hover away. Raw
 * `toLocaleDateString()` rendered a machine format (`7/20/2026`) and made a
 * project touched yesterday look the same as one touched last month.
 */
function ActivityLabel({ iso }: { iso: string }) {
  const label = formatRelative(iso);
  if (!label) return null;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className="ml-auto">
      Active {label}
    </time>
  );
}

/**
 * A single project card for the `/projects` grid (spec 26): name, its visibility
 * chip, viewer-scoped thread and task counts, and last activity. Presentational:
 * the counts are already scoped to what the viewer can see by the server page
 * that renders this, so the card never surfaces hidden content.
 */
export function ProjectCard({ id, name, clearance, threadCount, taskCount, lastActivity }: ProjectCardData) {
  const restrictedGroup = clearance.find((group) => group !== "all-hands");
  const visibility = restrictedGroup ? "restricted" : "all-hands";
  return (
    <Link
      href={`/projects/${id}`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 hover:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-semibold text-ink">{name}</h3>
        <VisibilityChip
          visibility={visibility}
          group={restrictedGroup ? groupLabel(restrictedGroup) : undefined}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="size-3.5" aria-hidden />
          {plural(threadCount, "thread")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="size-3.5" aria-hidden />
          {plural(taskCount, "task")}
        </span>
        <ActivityLabel iso={lastActivity} />
      </div>
    </Link>
  );
}

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { PersonChip } from "@/components/person-chip";
import { DueLabel } from "@/components/tasks/due-label";
import { getDb } from "@/lib/db/client";
import type { TaskRecord } from "@/lib/db/tasks";
import { resolveIdentity } from "@/lib/identity/resolve";
import { personDetail } from "@/lib/people/detail";
import { isPeopleActivityEnabled } from "@/lib/people/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TASK_GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "inProgress", label: "In progress" },
  { key: "open", label: "Open" },
  { key: "proposed", label: "Inbox" },
  // Not "Recently completed": a task carries no completion timestamp, so this
  // group is every done task, not a recent slice of them.
  { key: "completed", label: "Completed" },
] as const;

function TaskRow({ task }: { task: TaskRecord }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-surface-2"
    >
      <span className="min-w-0 truncate text-sm text-ink">{task.title}</span>
      {task.due && <DueLabel due={task.due} className="shrink-0 text-xs text-ink-muted" />}
    </Link>
  );
}

/**
 * One person's page (2026-08-05 people activity dashboard): the rows behind the
 * counts on `/people`.
 *
 * The 404 is load-bearing. `personDetail` returns null for anyone outside the
 * roster THIS viewer can see, so an uncleared viewer cannot tell an address that
 * does not exist apart from a colleague whose work they are not cleared to read.
 * Without that, the route would be a probe for both.
 */
export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  if (!isPeopleActivityEnabled()) notFound();

  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();

  const detail = personDetail(
    getDb(),
    identity.email,
    identity.clearance,
    decodeURIComponent((await params).email),
  );
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-4xl px-8 pb-14 pt-16">
      <Link
        href="/people"
        className="mb-6 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden />
        People
      </Link>

      <PageHeader
        eyebrow={<PersonChip person={detail.person} variant="avatar" />}
        title={detail.person.name}
        description={detail.person.email}
      />

      {/* Already empty unless the viewer administers access: personDetail owns that gate. */}
      {detail.groups.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {detail.groups.map((group) => (
            <span
              key={group}
              className="rounded-menu border border-line bg-surface-2 px-2 py-0.5 text-xs text-ink-muted"
            >
              {group}
            </span>
          ))}
        </div>
      )}

      <section className="mb-10">
        <h3 className="mb-3 text-sm font-semibold text-ink">Tasks</h3>
        {TASK_GROUPS.every((group) => detail.tasks[group.key].length === 0) ? (
          <p className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-6 text-center text-sm text-ink-muted">
            No tasks assigned.
          </p>
        ) : (
          TASK_GROUPS.filter((group) => detail.tasks[group.key].length > 0).map((group) => (
            <div key={group.key} className="mb-4">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.label}
              </h4>
              <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {detail.tasks[group.key].map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink">Meetings attended</h3>
        {detail.meetings.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-6 text-center text-sm text-ink-muted">
            No meetings you are cleared to see.
          </p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {detail.meetings.map((meeting) => (
              <Link
                key={meeting.notePath}
                href={meeting.href}
                className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-surface-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Calendar className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                  <span className="truncate text-sm text-ink">{meeting.title}</span>
                </span>
                <time dateTime={meeting.date} className="shrink-0 text-xs text-ink-muted">
                  {meeting.date}
                </time>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

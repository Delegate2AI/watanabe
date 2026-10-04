import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { assignableMembers, loadGroups } from "@/lib/authority/groups";
import { can, isRolesEnabled } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { canTransition, getVisibleTask, type TaskAction, type TaskRecord, type TaskStatus } from "@/lib/db/tasks";
import { getProjectForRequester } from "@/lib/db/projects";
import { listComments } from "@/lib/db/task-comments";
import { resolveIdentity } from "@/lib/identity/resolve";
import { vaultDocHref } from "@/lib/index/web-links";
import { isTaskCommentsEnabled, isTasksEnabled } from "@/lib/tasks/config";
import { canReadSourceNote } from "@/lib/tasks/source-note";
import { TaskActions } from "./task-actions";
import { DueLabel } from "@/components/tasks/due-label";
import { AssigneeChip } from "@/components/tasks/assignee";
import { TaskComments } from "@/components/tasks/task-comments";
import { resolvePeople } from "@/lib/people/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: "Proposed",
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};
const ACTIONS: TaskAction[] = ["accept", "dismiss", "complete", "assign", "reassign", "move", "delete"];

function sourceHref(notePath: string): string {
  return vaultDocHref(notePath.replace(/^docs\//, ""));
}

/**
 * A link only for a viewer whose projection actually holds the note. An attendee
 * the task's clearance does not cover sees the meeting's name-free fact that
 * there was one, rather than a link into a 404.
 */
function sourceCell(task: TaskRecord, viewerClearance: string[]) {
  if (!task.sourceNotePath) return "Manual task";
  if (!canReadSourceNote(task.clearance, viewerClearance)) return "Meeting you attended";
  return (
    <Link href={sourceHref(task.sourceNotePath)} className="font-medium text-ink hover:underline">
      Source meeting
    </Link>
  );
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isTasksEnabled()) notFound();
  const { id } = await params;
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();

  const db = getDb();
  const task = getVisibleTask(db, id, identity.email, identity.clearance);
  if (!task) notFound();

  const groups = loadGroups();
  // Read once: with roles enabled, can() reparses roles.yaml from disk on
  // every call, and this page needs the same manageAccess answer twice.
  const isAdmin = can(identity.email, "manageAccess");
  const actor = {
    email: identity.email.trim().toLowerCase(),
    clearance: identity.clearance,
    canTriage: !isRolesEnabled() || can(identity.email, "write"),
    // Must match isTaskCreator in app/api/tasks/[id]/route.ts exactly. Deriving
    // "creator" any other way here renders a Delete button the API then refuses.
    isCreator: (task.createdBy !== null && task.createdBy === identity.email.trim().toLowerCase())
      || isAdmin,
  };
  const allowedActions = ACTIONS.filter((action) => canTransition(task, action, actor).ok);
  const project = task.projectId
    ? getProjectForRequester(db, task.projectId, identity.email, identity.clearance)
    : null;
  const comments = isTaskCommentsEnabled() ? listComments(db, task.id) : [];
  // <PersonChip> takes an already-resolved person: the resolver reads the
  // directory from disk, so it runs here, never in the client island below.
  // Comment authors are included too, or an author who has since left a
  // group would render as a bare email.
  const members = assignableMembers(groups);
  const people = resolvePeople(
    [...members, ...(task.assigneeEmail ? [task.assigneeEmail] : []), ...comments.map((c) => c.authorEmail)],
    { viewerEmail: identity.email },
  );

  return (
    <div className="mx-auto max-w-4xl px-8 pb-14 pt-12">
      <Link href="/tasks" className="mb-6 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        All tasks
      </Link>
      <header className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">{STATUS_LABELS[task.status]}</span>
          <span className="text-xs text-ink-muted">{task.clearance.join(", ")}</span>
        </div>
        <h1 className="text-[30px] font-medium tracking-tight text-ink [font-family:var(--serif)]">{task.title}</h1>
      </header>
      <section className="rounded-xl border border-line bg-surface p-6">
        <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{task.description}</p>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-muted">Assignee</dt><dd className="mt-1 text-ink"><AssigneeChip email={task.assigneeEmail} people={people} /></dd></div>
          <div><dt className="text-ink-muted">Due</dt><dd className="mt-1 text-ink">{task.due ? <DueLabel due={task.due} /> : "No due date"}</dd></div>
          <div><dt className="text-ink-muted">Source</dt><dd className="mt-1">{sourceCell(task, identity.clearance)}</dd></div>
          <div><dt className="text-ink-muted">Project</dt><dd className="mt-1">{project ? <Link href={`/projects/${encodeURIComponent(project.id)}`} className="font-medium text-ink hover:underline">{project.name}</Link> : "No project"}</dd></div>
        </dl>
        <TaskActions task={task} members={members} people={people} allowedActions={allowedActions} />
      </section>
      {isTaskCommentsEnabled() ? (
        <TaskComments
          taskId={task.id}
          initialComments={comments}
          viewerEmail={actor.email}
          canModerate={isAdmin}
          people={people}
        />
      ) : null}
    </div>
  );
}

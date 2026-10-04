import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageSquare } from "lucide-react";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { ProjectContextEditor } from "@/components/projects/project-context-editor";
import { ProjectChat } from "@/components/projects/project-chat";
import { ProjectDocuments } from "@/components/projects/project-documents";
import { ProjectReferences } from "@/components/projects/project-references";
import { TaskCard } from "@/components/tasks/task-card";
import { getDb } from "@/lib/db/client";
import { getProjectForRequester, listThreads, listTasks } from "@/lib/db/projects";
import { listProjectDocuments } from "@/lib/db/project-docs";
import { attachableFor, resolveProjectReferences } from "@/lib/db/project-references";
import { resolvePeople } from "@/lib/people/resolve";
import { resolveIdentity } from "@/lib/identity/resolve";
import { requesterKey } from "@/lib/db/tasks-visibility";
import { isProjectsEnabled } from "@/lib/projects/config";
import { isDictationEnabled } from "@/lib/dictate/config";
import { modelAllowlist, isModelSwitchingEnabled } from "@/lib/agent/model-options";
import { personFor } from "@/components/person-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function groupLabel(group: string): string {
  return group.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

/**
 * The project detail view (spec 26). Clearance-scoped: a project the requester
 * cannot see, an unknown id, and (flag-off) any id all `notFound()` (no oracle).
 * Threads and tasks come pre-scoped to what the viewer can see (their own
 * threads, their cleared tasks). The owner may edit the description/context; a
 * new chat started here files into the project.
 */
export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isProjectsEnabled()) notFound();
  const { id } = await params;
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();

  const project = getProjectForRequester(getDb(), id, identity.email, identity.clearance);
  if (!project) notFound();

  const threads = listThreads(getDb(), id, identity.email, identity.clearance);
  const tasks = listTasks(getDb(), id, identity.email, identity.clearance);
  const documents = listProjectDocuments(getDb(), id);
  // Resolved with the requester's own email and clearance so a reference whose
  // target they can no longer read simply does not come back (the row
  // survives). Clearance is what a KB reference resolves against.
  const references = resolveProjectReferences(getDb(), id, identity.email, identity.clearance);
  // <PersonChip> takes an already-resolved person: the resolver reads the
  // directory from disk, so it runs here, never in the client island.
  const people = resolvePeople(
    [
      // The viewer, always: uploading a document adds its row client-side, and
      // an address missing here renders as the raw address, so your own upload
      // was credited to your email until the next full page load.
      identity.email,
      ...documents.map((doc) => doc.uploaderEmail),
      ...tasks.map((task) => task.assigneeEmail),
    ].filter((email): email is string => typeof email === "string" && email !== ""),
    { viewerEmail: identity.email },
  );
  const isOwner = project.ownerEmail.trim().toLowerCase() === identity.email.trim().toLowerCase();
  const restrictedGroup = project.clearance.find((group) => group !== "all-hands");

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-12">
      <Link href="/projects" className="mb-6 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        All projects
      </Link>

      <header className="mb-8 flex items-start justify-between gap-4">
        <h1 className="text-[27px] font-medium tracking-tight text-ink [font-family:var(--serif)]">{project.name}</h1>
        <VisibilityChip
          visibility={restrictedGroup ? "restricted" : "all-hands"}
          group={restrictedGroup ? groupLabel(restrictedGroup) : undefined}
        />
      </header>

      <section className="mb-10">
        <ProjectContextEditor
          projectId={project.id}
          description={project.description}
          context={project.context}
          canEdit={isOwner}
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink">New chat in this project</h2>
        <ProjectChat
          projectId={project.id}
          projectName={project.name}
          dictationEnabled={isDictationEnabled()}
          models={modelAllowlist()}
          modelSwitchingEnabled={isModelSwitchingEnabled()}
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink">Documents</h2>
        <ProjectDocuments projectId={project.id} initialDocuments={documents} people={people} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink">Referenced content</h2>
        <ProjectReferences
          projectId={project.id}
          initialReferences={references}
          initialCandidates={attachableFor(getDb(), identity.email)}
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink">Threads</h2>
        {threads.length === 0 ? (
          <p className="text-sm text-ink-muted">No threads filed here yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {threads.map((t) => (
              <li key={t.sdkSessionId}>
                <Link
                  href={`/chat/${t.sdkSessionId}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-ink hover:border-accent"
                >
                  <MessageSquare className="size-4 text-ink-muted" aria-hidden />
                  {t.title ?? "Untitled chat"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-muted">No tasks filed here yet.</p>
        ) : (
          <ul className="grid gap-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  people={people}
                  actorEmail={requesterKey(identity.email)}
                  {...(task.assigneeEmail
                    ? { assigneeName: personFor(people, task.assigneeEmail).name }
                    : {})}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

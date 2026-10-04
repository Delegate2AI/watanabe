import { headers } from "next/headers";
import { Folder } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { PageHeader } from "@/components/kit/page-header";
import { ProjectList } from "@/components/projects/project-list";
import { NewProjectButton } from "@/components/projects/new-project-button";
import { getDb } from "@/lib/db/client";
import { listProjectSummariesForRequester } from "@/lib/db/projects";
import { resolveIdentity } from "@/lib/identity/resolve";
import { isProjectsEnabled } from "@/lib/projects/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = {
  icon: Folder,
  eyebrow: "Projects",
  title: "Your spaces",
  description:
    "A project bundles a goal, its threads, and its own working context, all still scoped to your clearance.",
};

/**
 * The Projects surface (spec 26), filling the spec-18 scaffold. Flag-off
 * (`PROJECTS_ENABLED` unset) it renders the identical scaffold as before, so the
 * byte-path is unchanged. On: the caller's cleared projects as a card grid, with
 * viewer-scoped counts (never surfacing threads/tasks the caller cannot see).
 */
export default async function ProjectsPage() {
  if (!isProjectsEnabled()) {
    return <RouteScaffold {...HEADER} spec="spec 26" flag="PROJECTS_ENABLED" />;
  }

  const identity = await resolveIdentity(await headers());
  const summaries = identity
    ? listProjectSummariesForRequester(getDb(), identity.email, identity.clearance)
    : [];

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader icon={HEADER.icon} eyebrow={HEADER.eyebrow} title={HEADER.title} description={HEADER.description} />
      <div className="mb-6">
        <NewProjectButton />
      </div>
      {summaries.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No projects yet. Create one to group the threads, tasks, and working context for a goal.
        </p>
      ) : (
        <ProjectList
          projects={summaries.map((s) => ({
            id: s.project.id,
            name: s.project.name,
            clearance: s.project.clearance,
            threadCount: s.threadCount,
            taskCount: s.taskCount,
            lastActivity: s.lastActivity,
          }))}
        />
      )}
    </div>
  );
}

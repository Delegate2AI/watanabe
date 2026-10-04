import { headers } from "next/headers";
import { Users } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { PageHeader } from "@/components/kit/page-header";
import { ActivityWindowToggle } from "@/components/people/activity-window-toggle";
import { PersonActivityRow } from "@/components/people/person-activity-row";
import { getDb } from "@/lib/db/client";
import { resolveIdentity } from "@/lib/identity/resolve";
import { personActivity, type ActivityWindow, type PersonActivity } from "@/lib/people/activity";
import { isPeopleActivityEnabled } from "@/lib/people/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = {
  icon: Users,
  eyebrow: "People",
  title: "Who is doing what",
  description:
    "Everyone you are cleared to see, with the meetings they attended and the work assigned to them.",
};

const WINDOWS: ActivityWindow[] = ["7d", "30d", "all"];

/** Anything unrecognized falls back to the default rather than erroring on a hand-typed URL. */
function windowFrom(value: string | undefined): ActivityWindow {
  return WINDOWS.find((candidate) => candidate === value) ?? "30d";
}

/**
 * Idle means nothing in any column. Those rows are kept and grouped rather than
 * dropped, because "this person has nothing recorded" is a finding on a page
 * built to answer who is doing what, not an absence worth hiding.
 */
function isIdle(activity: PersonActivity): boolean {
  const { open, overdue, proposed, completed } = activity.tasks;
  return (
    open === 0 &&
    overdue === 0 &&
    proposed === 0 &&
    completed === 0 &&
    activity.meetings.inWindow === 0
  );
}

/** Overdue first, then most loaded, then alphabetical, so a scan starts where the trouble is. */
function byAttention(left: PersonActivity, right: PersonActivity): number {
  return right.tasks.overdue - left.tasks.overdue
    || right.tasks.open - left.tasks.open
    || left.person.name.localeCompare(right.person.name);
}

/**
 * The People surface (2026-08-05 people activity dashboard). Flag-off it renders
 * the standard dormant scaffold and the sidebar shows no entry for it, so the
 * byte-path with the flag off is unchanged.
 *
 * Every row is filtered by the VIEWER's own clearance: the two readers behind
 * `personActivity` are already scoped (in SQL for tasks, by vault projection for
 * meetings), so this page introduces no new authority concept and a person whose
 * work sits entirely outside the viewer's clearance never appears.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  if (!isPeopleActivityEnabled()) {
    return <RouteScaffold {...HEADER} spec="2026-08-05 people activity" flag="PEOPLE_ACTIVITY_ENABLED" />;
  }

  const activeWindow = windowFrom((await searchParams).window);
  const identity = await resolveIdentity(await headers());
  const everyone = identity
    ? personActivity(getDb(), identity.email, identity.clearance, activeWindow)
    : [];

  const active = everyone.filter((entry) => !isIdle(entry)).sort(byAttention);
  const idle = everyone.filter(isIdle).sort((left, right) =>
    left.person.name.localeCompare(right.person.name));

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader {...HEADER} />

      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">
          Task counts are current. Meetings follow the range.
        </p>
        <ActivityWindowToggle value={activeWindow} />
      </div>

      {everyone.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-muted">
          Nobody has meetings or tasks yet. People appear here as meetings are ingested and action
          items are assigned.
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {active.map((entry) => (
            <PersonActivityRow key={entry.person.email} activity={entry} />
          ))}
        </div>
      )}

      {idle.length > 0 && (
        <>
          <h3 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            No recent activity
          </h3>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {idle.map((entry) => (
              <PersonActivityRow key={entry.person.email} activity={entry} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

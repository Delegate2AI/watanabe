import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Blocks } from "lucide-react";
import { SkillsAdmin } from "@/components/admin/skills-admin";
import type { SkillRow } from "@/components/admin/skills-types";
import { PageHeader } from "@/components/kit/page-header";
import { tripsNonInterpreterTierZero } from "@/lib/agent/bash-patterns";
import { loadAccess } from "@/lib/authority/access";
import { ALL_HANDS } from "@/lib/authority/group-keys";
import { can } from "@/lib/authority/roles";
import { resolveIdentity } from "@/lib/identity/resolve";
import { scrubReason, storeDirExists } from "@/lib/skills/admin-record";
import { isSkillsEnabled } from "@/lib/skills/config";
import { TRUNCATION_SUFFIX } from "@/lib/skills/compat";
import { marketplaceSourceIds } from "@/lib/skills/marketplace-builtin";
import { loadSkillRegistry } from "@/lib/skills/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Spec 34's admin surface: the installed Agent Skill registry.
 *
 * Gated exactly like `/admin/connectors` (`notFound()` for anyone without
 * `manageAccess`) plus the subsystem flag, so with `SKILLS_ENABLED` off the page
 * does not exist and the sidebar shows no link to it. Nothing below the gates
 * runs first: the registry, the store, and the marketplace config are read only
 * after the capability check.
 *
 * The registry, the store lstat, and the group names are all resolved HERE. All
 * three reach `node:fs`, and the admin surface is a client island, so it receives
 * plain serializable rows and never imports a loader itself.
 *
 * The marketplace indexes are NOT resolved here, and deliberately so. Fetching
 * them on render would put a network fan-out (one request per configured index,
 * each with its own deadline) on the critical path of a page that
 * `router.refresh()` re-runs after every single mutation, so installing five
 * marketplace picks would mean six fan-out rounds. Only the COUNT is read here,
 * which is a config read, and the tab loads the indexes itself the first time an
 * admin actually opens it.
 */
export default async function SkillsAdminPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  if (!isSkillsEnabled()) notFound();
  if (!can(identity.email, "manageAccess")) notFound();

  const registry = loadSkillRegistry();
  // Same shape GET /api/admin/skills returns, so a refreshed render and the
  // route agree on what a row looks like, plus the derived blocked-script list.
  const entries: SkillRow[] = [
    ...registry.entries.map((entry) => ({
      ...entry,
      status: "ok" as const,
      installed: storeDirExists(entry.slug),
      blockedScripts: recordedScripts(entry.compat.scripts).filter(tripsNonInterpreterTierZero),
      scriptsTruncated: scriptsAreCapped(entry.compat.scripts),
    })),
    ...registry.errors.map((error) => ({
      slug: error.slug,
      status: "disabled" as const,
      // Scrubbed on the same rule the route uses: a loader reason is derived
      // text and can carry an absolute server path.
      reason: scrubReason(error.reason),
      installed: false,
      blockedScripts: [],
      scriptsTruncated: false,
    })),
  ].sort((a, b) => a.slug.localeCompare(b.slug));

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Blocks}
        eyebrow="Administration"
        title="Skills"
        description="Install the Agent Skills this workspace offers. Every change is recorded on the private access history, and a skill is loaded only into sessions cleared for a group listed on it."
      />
      <SkillsAdmin
        entries={entries}
        groupNames={groupNames()}
        marketplaceCount={marketplaceSourceIds().length}
      />
    </div>
  );
}

function groupNames(): string[] {
  // See the connectors page: `all-hands` is implicit, so offer it explicitly or
  // a skill can never be installed for the whole workspace.
  return [ALL_HANDS, ...Object.keys(loadAccess().groups).filter((g) => g !== ALL_HANDS).sort()];
}

/** What `capList` appends in place of the entries it dropped past its cap. */
const CAP_MARKER_RE = /^\+\d+ more$/;

/** The persisted list minus that marker, which is a count and not a script. */
function recordedScripts(scripts: string[]): string[] {
  return scripts.filter((script) => !CAP_MARKER_RE.test(script));
}

/**
 * Whether the recorded script list can still support a COMPLETE blocked-script
 * derivation.
 *
 * `buildCompatReport` derives its own blocked list from the raw file list and
 * caps afterwards, while this page only ever sees what `SkillEntry.compat`
 * persisted: at most MAX_COMPAT_ITEMS entries, each clipped to
 * MAX_COMPAT_ITEM_CHARS. So a skill with more scripts than the cap, or a path
 * whose tripping token sits past the clip, would be flagged at install time and
 * show nothing on its row afterwards. Both cases leave a visible marker in the
 * persisted strings, so the row can say the list is short rather than imply it
 * is whole.
 */
function scriptsAreCapped(scripts: string[]): boolean {
  return scripts.some((script) => CAP_MARKER_RE.test(script) || script.endsWith(TRUNCATION_SUFFIX));
}

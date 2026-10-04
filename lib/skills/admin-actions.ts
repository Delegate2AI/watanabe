import { log } from "@/lib/log";
import {
  checkGroups,
  recordInstalledSkill,
  rollbackStoreDir,
  storeDirExists,
  type InstalledSkill,
  type RecordResult,
} from "./admin-record";
import { installFromGit, type InstallResult } from "./install";
import { invalidateMaterializedSkills } from "./materialize";
import { installFromMarketplace } from "./marketplace";
import { marketplaceSourceIds, resolveMarketplaceIndex } from "./marketplace-builtin";
import { loadSkillRegistry } from "./registry";
import { removeInstalledSkill, writeSkills } from "./store";
import type { SkillEntry } from "./types";

/**
 * The five JSON actions behind `POST /api/admin/skills`, kept out of the route
 * so the route is only the gate, the schema, and the translation to codes.
 *
 * Every arm is ordered the same way: refuse on what the request said before
 * anything touches the network, the store, or the access ref.
 */

export type SkillAdminAction =
  | { action: "install-git"; url: string; ref: string; subdir?: string; groups: string[] }
  // No ref or subdir: a marketplace pick takes both from the index entry, so a
  // request cannot substitute its own for the ones the index vouched for.
  | { action: "install-marketplace"; index: string; name: string; url: string; groups: string[] }
  | { action: "uninstall"; slug: string }
  | { action: "update"; slug: string }
  | { action: "set-groups"; slug: string; groups: string[] };

export type SkillAdminResult =
  | {
      ok: true;
      slug: string;
      replaced?: boolean;
      commit?: string;
      previousCommit?: string;
      warning?: string;
      blockedScripts?: string[];
    }
  | { ok: false; kind: "install"; reason: string }
  | { ok: false; kind: "write"; error: string }
  | { ok: false; kind: "invalid"; detail: string }
  | { ok: false; kind: "overwrote"; slug: string; victim: string }
  | { ok: false; kind: "not_found" };

export async function runSkillAdminAction(
  action: SkillAdminAction,
  actorEmail: string,
): Promise<SkillAdminResult> {
  switch (action.action) {
    case "install-git":
      return installGit(action, actorEmail);
    case "install-marketplace":
      return installMarketplace(action, actorEmail);
    case "uninstall":
      return uninstall(action.slug, actorEmail);
    case "update":
      return update(action.slug, actorEmail);
    case "set-groups":
      return setGroups(action.slug, action.groups, actorEmail);
  }
}

async function installGit(
  action: Extract<SkillAdminAction, { action: "install-git" }>,
  actorEmail: string,
): Promise<SkillAdminResult> {
  const groups = checkGroups(action.groups);
  if (!groups.ok) return { ok: false, kind: "invalid", detail: "groups" };
  // url, ref, and subdir go straight into `lib/skills/git-args.ts`, which owns
  // every defense against them: argv arrays, the `--` terminator, the
  // dash-leading refusal, and realpath-based subdir containment. Nothing here
  // pre-processes them, so there is exactly one path into git.
  const result = await installFromGit(
    {
      url: action.url,
      ref: action.ref,
      ...(action.subdir === undefined ? {} : { subdir: action.subdir }),
    },
    { sourceType: "git" },
  );
  return finishInstall(result, groups.groups, actorEmail);
}

/**
 * A marketplace pick, taken from the index rather than from the request.
 *
 * Both halves of the provenance are checked, because checking only one is worse
 * than checking neither: the index URL must be one the operator configured in
 * portal.yaml, AND the `{name, url}` pair the request names must actually
 * appear in that index. Without the second check an admin could install any
 * repository at all and have it recorded as `source: {type: "marketplace",
 * index: <the corporate index>}`, which is exactly the claim the first check
 * exists to make true. The item that reaches git is then the INDEX's item, so
 * its ref and subdir come from the document that vouched for it and a request
 * cannot substitute its own.
 */
async function installMarketplace(
  action: Extract<SkillAdminAction, { action: "install-marketplace" }>,
  actorEmail: string,
): Promise<SkillAdminResult> {
  const groups = checkGroups(action.groups);
  if (!groups.ok) return { ok: false, kind: "invalid", detail: "groups" };
  if (!marketplaceSourceIds().includes(action.index)) {
    return { ok: false, kind: "invalid", detail: "index" };
  }
  const index = await resolveMarketplaceIndex(action.index);
  if (!index.ok) return { ok: false, kind: "install", reason: index.reason };
  const item = index.items.find(
    (candidate) => candidate.name === action.name && candidate.url === action.url,
  );
  if (item === undefined) return { ok: false, kind: "invalid", detail: "item" };

  // ONE argument, deliberately. `installFromMarketplace(item, install)` has a
  // dependency-injection seam for tests only; passing it from here would let a
  // request decide which local code path runs, which is the property the http(s)
  // restriction on marketplace URLs exists to keep. Do not thread a second
  // parameter through.
  const result = await installFromMarketplace({ ...item, index: action.index });
  return finishInstall(result, groups.groups, actorEmail);
}

async function uninstall(slug: string, actorEmail: string): Promise<SkillAdminResult> {
  // The whole uninstall, never `writeSkills({verb:"remove"})` on its own: that
  // clears the registry row and leaves the skill's content on disk.
  const removed = await removeInstalledSkill(slug, actorEmail);
  if (!removed.ok) return { ok: false, kind: "write", error: removed.error };
  // The store removal inside `removeInstalledSkill` is best effort and only
  // logs, so an orphaned directory would otherwise be invisible to the admin
  // who asked for the uninstall.
  if (storeDirExists(slug)) {
    log.warn("skill uninstalled but its store directory remains", { slug });
    return { ok: true, slug, warning: "store_directory_remains" };
  }
  return { ok: true, slug };
}

async function update(slug: string, actorEmail: string): Promise<SkillAdminResult> {
  const entry = loadSkillRegistry().entries.find((candidate) => candidate.slug === slug);
  if (entry === undefined) return { ok: false, kind: "not_found" };
  if (entry.source.type === "zip" || entry.source.type === "authored") return { ok: false, kind: "invalid", detail: "source" };

  const result = await refetch(entry);
  if (!result.ok) return { ok: false, kind: "install", reason: result.reason };
  if (result.slug !== slug) return renamed(slug, result.slug);
  return finishInstall(result, entry.groups, actorEmail);
}

/**
 * A re-fetch whose content slugifies onto a different name than the entry being
 * updated. The tree has already landed under the produced slug, because the
 * install pipeline only learns the slug from frontmatter after `landSkillDir`
 * has run, so by the time this is reached there are two possible states and
 * they are not equally serious.
 *
 * If nothing is registered under the produced slug, the landing is an orphan: it
 * is removed and this is an ordinary refusal.
 *
 * If a skill IS registered under it, that skill's folder now holds this
 * content while its registry row (title, groups, pinned commit) is untouched,
 * so the substituted content is what every session cleared for the VICTIM's
 * groups will be served, on the next session and with no invalidation needed,
 * because materialization symlinks the store. That is a clearance boundary
 * being crossed by a routine update click, so it is reported as loudly as this
 * layer can: an error log, a machine-readable `warning` naming the victim, and
 * a reason sentence saying the folder must be reinstalled. It is deliberately
 * NOT rolled back, since deleting the directory would leave the victim's
 * registry row pointing at nothing; the admin needs to reinstall it, and needs
 * to be told so rather than shown a generic refusal.
 */
function renamed(slug: string, produced: string): SkillAdminResult {
  if (!loadSkillRegistry().entries.some((candidate) => candidate.slug === produced)) {
    log.warn("skill update produced a different slug", { slug, produced });
    rollbackStoreDir(produced);
    return { ok: false, kind: "invalid", detail: "slug" };
  }
  log.error("skill update overwrote another installed skill", { slug, victim: produced });
  return { ok: false, kind: "overwrote", slug, victim: produced };
}

/** Re-fetch a pinned source through the same installer that first produced it. */
async function refetch(entry: SkillEntry): Promise<InstallResult> {
  if (entry.source.type === "git") {
    return installFromGit(
      {
        url: entry.source.url,
        ref: entry.source.ref,
        ...(entry.source.subdir === undefined ? {} : { subdir: entry.source.subdir }),
      },
      { sourceType: "git" },
    );
  }
  if (entry.source.type === "marketplace") {
    return installFromMarketplace({
      index: entry.source.index,
      name: entry.source.name,
      description: "",
      url: entry.source.url,
      ...(entry.source.subdir === undefined ? {} : { subdir: entry.source.subdir }),
    });
  }
  if (entry.source.type === "authored") {
    return { ok: false, reason: "an authored skill is edited in the portal, not re-fetched" };
  }
  return { ok: false, reason: "a zip-installed skill has no remote to re-fetch" };
}

async function setGroups(
  slug: string,
  requested: string[],
  actorEmail: string,
): Promise<SkillAdminResult> {
  const checked = checkGroups(requested);
  if (!checked.ok) return { ok: false, kind: "invalid", detail: "groups" };
  const groups = checked.groups;
  const written = await writeSkills({ verb: "setGroups", slug, groups }, actorEmail);
  if (!written.ok) return { ok: false, kind: "write", error: written.error };
  invalidateMaterializedSkills();
  return { ok: true, slug };
}

/** Shared tail of every install: record it, or report why it could not be. */
export async function finishInstall(
  result: InstallResult,
  groups: string[],
  actorEmail: string,
): Promise<SkillAdminResult> {
  if (!result.ok) return { ok: false, kind: "install", reason: result.reason };
  const recorded = await recordInstalledSkill(result, groups, actorEmail);
  return toResult(recorded, result);
}

function toResult(recorded: RecordResult, install: InstalledSkill): SkillAdminResult {
  if (!recorded.ok) return { ok: false, kind: "write", error: recorded.error };
  // Scripts the bash policy can never run are reported at install time, which is
  // the admin's one chance to notice before a user meets a silent runtime deny.
  const blocked = install.validation.compat.blockedScripts;
  return {
    ...recorded,
    ...(blocked.length === 0 ? {} : { blockedScripts: [...blocked] }),
  };
}

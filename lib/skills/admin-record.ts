import { log } from "@/lib/log";
import { toRegistryCompat, type InstallResult } from "./install";
import { uninstallSkill } from "./install-store";
import { invalidateMaterializedSkills } from "./materialize";
import { loadSkillRegistry } from "./registry";
import { writeSkills } from "./store";

/**
 * The half of the admin skills surface that both POST routes share: turning a
 * finished install into a registry entry, and the small guards that run before
 * one starts.
 *
 * Kept out of the routes because `/api/admin/skills` (git and marketplace) and
 * `/api/admin/skills/upload` (zip) must record an install the SAME way. The
 * add-or-update choice, the rollback rule, and the materialization invalidation
 * are correctness properties, not per-route detail, so there is one copy.
 */

export type InstalledSkill = Extract<InstallResult, { ok: true }>;

export type RecordResult =
  | { ok: true; slug: string; replaced: boolean; commit?: string; previousCommit?: string }
  | { ok: false; error: string };

/**
 * Clearance-list validation is shared with the connectors admin surface (see
 * `lib/authority/group-keys.ts`), so the two near-twins cannot drift into one
 * refusing a typo'd group key and the other accepting it. Re-exported under the
 * skills-side names its existing callers already import.
 */
export {
  checkGroups,
  unknownGroups,
  MAX_GROUP_KEY_CHARS,
  MAX_CLEARANCE_GROUPS as MAX_SKILL_GROUPS,
  type CheckedGroups,
} from "@/lib/authority/group-keys";

export { storeDirExists } from "./preflight";

/**
 * Reason scrubbing is shared with the connectors admin surface, for the same
 * reason group validation is. Re-exported so this module's existing callers keep
 * one import.
 */
export { scrubReason } from "@/lib/errors/scrub-reason";

/**
 * Record a finished install in `access/skills.yaml`.
 *
 * Add or update is decided by what the registry already carries, not by which
 * route called: the install pipeline only learns the slug from the skill's own
 * frontmatter AFTER the tree has landed in the store, so an install whose slug
 * is already registered has already replaced that skill's content and is a
 * re-install by the time this runs. Answering it with `add` would fail on
 * "duplicate slug" and then roll back a directory the registry still points at.
 *
 * Rollback is therefore only correct on the add path, where a failed registry
 * write leaves a store directory nothing references. On the update path the
 * previous content is already gone, so removing the directory would delete a
 * live skill to report a failed write; the store keeps the new content and the
 * admin can retry.
 *
 * Materializations are invalidated on success. The key already includes the
 * registry's mtime and size, so a stale tree can never be SELECTED after a
 * committed change; sweeping here is what stops the superseded directories from
 * accumulating.
 */
export async function recordInstalledSkill(
  install: InstalledSkill,
  groups: string[],
  actorEmail: string,
): Promise<RecordResult> {
  const slug = install.slug;
  const existing = loadSkillRegistry().entries.find((entry) => entry.slug === slug);
  const compat = toRegistryCompat(install.validation);
  const title = install.validation.name;

  if (existing === undefined) {
    const entry = { slug, title, source: install.source, groups, compat };
    const written = await writeSkills({ verb: "add", entry }, actorEmail);
    if (!written.ok) {
      rollbackStoreDir(slug);
      return { ok: false, error: written.error };
    }
  } else {
    const written = await writeSkills(
      { verb: "update", slug, title, source: install.source, compat },
      actorEmail,
    );
    if (!written.ok) return { ok: false, error: written.error };
    if (!sameGroups(existing.groups, groups)) {
      const regrouped = await writeSkills({ verb: "setGroups", slug, groups }, actorEmail);
      if (!regrouped.ok) return { ok: false, error: regrouped.error };
    }
  }

  invalidateMaterializedSkills();
  return {
    ok: true,
    slug,
    replaced: existing !== undefined,
    ...commitOf(install.source, "commit"),
    ...(existing === undefined ? {} : commitOf(existing.source, "previousCommit")),
  };
}

/** A zip source has no commit to pin, so the field is omitted rather than empty. */
function commitOf(
  source: InstalledSkill["source"],
  key: "commit" | "previousCommit",
): Record<string, string> {
  return "commit" in source ? { [key]: source.commit } : {};
}

function sameGroups(a: string[], b: string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((group, index) => group === right[index]);
}

/**
 * Remove a store directory the registry never came to reference. Best effort by
 * design: the failure to report is the registry write's, and an orphaned
 * directory no lister and no materializer will read is not worth turning into a
 * second, less useful error.
 */
export function rollbackStoreDir(slug: string): void {
  try {
    uninstallSkill(slug);
  } catch (error) {
    log.warn("skill store rollback failed", { slug, err: describe(error) });
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}

import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { log } from "@/lib/log";
import { isSkillsEnabled, skillsFilePath, skillsMaterializedDir, skillsStoreDir } from "./config";
import {
  buildPluginDir,
  isCompletePlugin,
  STAGING_PREFIX,
  usableSkillDir,
} from "./materialize-build";
import { isMaterializationKey, materializationKey } from "./materialize-key";
import { loadSkillRegistry } from "./registry";
import type { SkillEntry } from "./types";

/**
 * Per-clearance plugin materializer (spec 34).
 *
 * Turns the installed skill store plus `access/skills.yaml` clearance tags into
 * one SDK local-plugin directory per distinct clearance set, so a session sees
 * exactly the skills its caller is cleared for. Filtering is by physical
 * absence, the same philosophy as spec 19's per-clearance vault projections: a
 * skill the caller may not use is not in the directory the SDK is given, so
 * there is nothing for a prompt to talk its way past.
 *
 * Clearance semantics, fail closed on both sides:
 * - An entry is visible iff its `groups` intersect the caller's clearance set.
 * - An empty `groups` list therefore means "nobody", never "everybody".
 * - An empty clearance set therefore sees nothing at all.
 *
 * Never-throws contract: this runs on the session path, so a missing store, a
 * tampered store entry, an unwritable output root, or a broken registry all
 * degrade to `null` (a session with no skills) rather than a dead session.
 */

export type MaterializedSkillsPlugin = {
  /** Absolute path to pass to the SDK as `plugins: [{ type: "local", path }]`. */
  pluginPath: string;
  /** Slugs actually present in the directory, sorted. Feeds the `Skill` permission gate. */
  slugs: string[];
};

export type MaterializeOptions = {
  /** Test-only overrides; production calls this with the clearance set alone. */
  registryPath?: string;
  storeDir?: string;
  outDir?: string;
};

export function materializeSkillsPlugin(
  clearanceSet: string[],
  opts: MaterializeOptions = {},
): MaterializedSkillsPlugin | null {
  // Flag off: no registry read, no directory created, no plugin passed. Every
  // existing byte-path stays identical.
  if (!isSkillsEnabled()) return null;
  try {
    return materialize(clearanceSet, opts);
  } catch (error) {
    log.error("skills materialization failed", { err: describe(error) });
    return null;
  }
}

/**
 * Drop every materialized directory. Called after an uninstall, an update, or a
 * groups edit so no stale tree can be served.
 *
 * The root itself is NEVER removed, and neither is anything in it that this
 * module did not create. Only children whose names are 16-hex materialization
 * keys, plus abandoned staging directories, are deleted. That guard is the
 * whole safety argument: callers are admin routes and the registry writer, so
 * `outDir` is one misconfiguration or one request-derived string away from
 * being a recursive force-delete of the skill store, portal.db's directory, or
 * the vault. Narrowing the blast radius to "key-shaped children of a root" is
 * what makes the parameter safe to keep for tests.
 *
 * `rmSync` unlinks symlinks rather than recursing through them, so removing a
 * materialization can never reach the store content it links to.
 */
export function invalidateMaterializedSkills(outDir?: string): void {
  const root = path.resolve(outDir ?? skillsMaterializedDir());
  brokenSkillsWarned.clear();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    // Nothing has been materialized (or the root is not readable): nothing to do.
    return;
  }
  for (const name of names) {
    if (!isMaterializationKey(name) && !isReapableStaging(root, name)) continue;
    try {
      rmSync(path.join(root, name), { recursive: true, force: true });
    } catch (error) {
      // Worst case is a stale directory nobody is keyed to any more, so this is
      // not worth failing an admin action over.
      log.warn("skills materialization cleanup failed", { name, err: describe(error) });
    }
  }
}

/** A staging directory is abandoned once it is older than any build could be. */
const STALE_STAGING_MS = 60_000;

/**
 * Staging trees are named by `mkdtemp`, so they are not key-shaped and are never
 * served. They are still reaped here, since nothing else collects them if a
 * process dies mid-build. Age-gated so a build running concurrently with an
 * admin action does not get its tree pulled out from under it.
 */
function isReapableStaging(root: string, name: string): boolean {
  if (!name.startsWith(STAGING_PREFIX)) return false;
  try {
    return Date.now() - statSync(path.join(root, name)).mtimeMs > STALE_STAGING_MS;
  } catch {
    return false;
  }
}

function materialize(
  clearanceSet: string[],
  opts: MaterializeOptions,
): MaterializedSkillsPlugin | null {
  const registryPath = path.resolve(opts.registryPath ?? skillsFilePath());
  let registryStat: { mtimeMs: number; size: number };
  try {
    registryStat = statSync(registryPath);
  } catch {
    // No registry file means no admin has installed anything: zero skills,
    // nothing to build, and nothing is wrong.
    return null;
  }

  const clearance = new Set(clearanceSet);
  const registry = loadSkillRegistry(registryPath);
  const storeDir = path.resolve(opts.storeDir ?? skillsStoreDir());
  const visible = registry.entries.filter((entry) => isVisible(entry, clearance));
  const usable = visible.filter((entry) => isUsable(entry, storeDir));
  if (usable.length === 0) return null;

  const slugs = usable.map((entry) => entry.slug).sort();
  const key = materializationKey({
    clearance: clearanceSet,
    registryPath,
    registryMtimeMs: registryStat.mtimeMs,
    registrySize: registryStat.size,
    storeDir,
    visible: usable.map((entry) => ({ slug: entry.slug, source: entry.source })),
  });
  const pluginPath = path.join(path.resolve(opts.outDir ?? skillsMaterializedDir()), key);

  if (isCompletePlugin(pluginPath, slugs)) return { pluginPath, slugs };
  buildPluginDir(pluginPath, storeDir, slugs);
  // A build that landed but does not resolve (a store directory removed between
  // the usability check and the link) must not be handed to a session.
  if (!isCompletePlugin(pluginPath, slugs)) return null;
  return { pluginPath, slugs };
}

/** Intersection, and only intersection: no group list and no clearance both mean "nothing". */
function isVisible(entry: SkillEntry, clearance: ReadonlySet<string>): boolean {
  return entry.groups.some((group) => clearance.has(group));
}

/**
 * Slugs already reported as broken. Materialization runs per caller per session
 * build, so one permanently broken skill would otherwise log on every turn of
 * every conversation. Cleared on invalidation, which is exactly when the store
 * has changed and the condition is worth reporting again.
 */
const brokenSkillsWarned = new Set<string>();

function isUsable(entry: SkillEntry, storeDir: string): boolean {
  if (usableSkillDir(storeDir, entry.slug) !== null) return true;
  // Broken rather than fatal: the admin list surfaces the same condition, and
  // the remaining skills still materialize.
  const seen = `${storeDir}\0${entry.slug}`;
  if (!brokenSkillsWarned.has(seen)) {
    brokenSkillsWarned.add(seen);
    log.warn("skill skipped: no usable directory in the store", { slug: entry.slug, storeDir });
  }
  return false;
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}

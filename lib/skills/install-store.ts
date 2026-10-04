import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { skillsStoreDir } from "./config";
import { RESERVED_SKILL_SLUGS, SLUG_RE } from "./types";

/**
 * Store-side filesystem seam for the install pipeline (spec 34).
 *
 * Two guarantees, both load bearing:
 *
 * 1. **A slug can never escape the store.** Every path here is built from a
 *    slug that has been re-checked against `SLUG_RE` and the reserved list,
 *    even though validation already produced it. The slug is the only
 *    caller-shaped component of a path that gets renamed onto and removed
 *    recursively, so it gets checked at the point of use, not only upstream.
 * 2. **A landing is all or nothing.** `landSkillDir` renames the previous
 *    install aside, renames the new tree into place, and only then deletes the
 *    aside. A failure mid-way puts the previous install back. There is never a
 *    window in which the store holds a half-written skill directory.
 *
 * Staging happens under the store's PARENT so the final `rename` is within one
 * filesystem and therefore atomic. A staging directory under `os.tmpdir()`
 * would routinely be on a different mount from a deployment's data volume,
 * where `rename` fails with `EXDEV` and the only fallback is a copy, which is
 * neither atomic nor symlink-safe.
 */

/** Prefix for staging dirs, so a crashed process leaves something identifiable. */
export const STAGING_PREFIX = ".skill-install-";

/** Prefix for the rename-aside of a previous install. Never matches `SLUG_RE`, so no lister sees it as a skill. */
const ASIDE_PREFIX = ".replacing-";

function assertSafeSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error(`unsafe skill slug: "${slug}"`);
  if (RESERVED_SKILL_SLUGS.has(slug)) throw new Error(`reserved skill slug: "${slug}"`);
}

/** `lstat`, never `stat`: a dangling symlink at the target still counts as present. */
function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fresh staging directory on the store's filesystem. The caller owns it and
 * must remove it on every exit path.
 */
export function makeStagingDir(): string {
  const store = skillsStoreDir();
  mkdirSync(store, { recursive: true });
  return mkdtempSync(path.join(path.dirname(store), STAGING_PREFIX));
}

/** Absolute path of an installed skill's directory in the store. */
export function skillDirFor(slug: string): string {
  assertSafeSlug(slug);
  return path.join(skillsStoreDir(), slug);
}

/**
 * Move a fully validated skill tree into the store under `slug`, replacing any
 * previous install of that slug atomically.
 *
 * `rename` is used rather than a copy so the tree that was validated is
 * byte-for-byte the tree that gets installed, and so nothing is dereferenced on
 * the way in. Throws on failure; the orchestrator turns that into a result.
 */
export function landSkillDir(tempSkillDir: string, slug: string): void {
  assertSafeSlug(slug);
  const store = skillsStoreDir();
  mkdirSync(store, { recursive: true });
  const target = path.join(store, slug);
  const aside = path.join(store, `${ASIDE_PREFIX}${slug}-${randomUUID()}`);

  const replacing = pathExists(target);
  if (replacing) renameSync(target, aside);
  try {
    renameSync(tempSkillDir, target);
  } catch (error) {
    if (replacing) renameSync(aside, target);
    throw error;
  }
  // Past this point the new tree IS at target and the install has succeeded, so
  // a failure to delete the aside must not be reported as a failed install: the
  // caller would get ok:false for a store that now holds the new skill, and
  // would roll back state that is already live. The worst case of swallowing it
  // is one leftover dot-directory, which cannot match SLUG_RE and so is invisible
  // to every lister.
  if (replacing) {
    try {
      rmSync(aside, { recursive: true, force: true });
    } catch {
      // Intentionally ignored, see above.
    }
  }
}

/** Remove an installed skill's store directory. Tolerant of it not being there. */
export function uninstallSkill(slug: string): void {
  rmSync(skillDirFor(slug), { recursive: true, force: true });
}

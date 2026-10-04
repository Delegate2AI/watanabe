import { lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fetchGitSkill } from "./install-git";
import { landSkillDir, makeStagingDir } from "./install-store";
import { DEFAULT_ZIP_CAPS, extractSkillZip, SKILL_DIR_MODE, type ZipCaps } from "./install-zip";
import { preflightRefusalReason, preflightSlug, type PreflightSourceType } from "./preflight";
import { withSkillSlugLock } from "./slug-lock";
import type { SkillCompat, SkillSource } from "./types";
import { SKILL_MANIFEST, validateSkillDir, type SkillValidation } from "./validate";

/**
 * Install orchestrator for spec 34's admin-installed skills.
 *
 * One shape for all three sources: fetch into a staging directory on the
 * store's own filesystem, validate the tree that is actually going to be
 * installed, then rename it into the store. The order matters:
 *
 * - Validation runs on the FINAL content, never on a copy of it. Nothing is
 *   copied at any point, so the tree that passed the validator (which refuses
 *   symlinks outright) is the exact tree that lands, and no symlink is ever
 *   dereferenced on the way in.
 * - The staging directory is removed on every exit path, success included, so
 *   a failed install leaves no partial content anywhere.
 * - Nothing touches the store until validation has passed, so a rejected skill
 *   cannot clobber a previously good install of the same slug.
 *
 * Never throws: every failure, including an unexpected one, comes back as
 * `{ ok: false, reason }`.
 */

export type ValidSkill = Extract<SkillValidation, { ok: true }>;

export type InstallResult =
  | { ok: true; slug: string; validation: ValidSkill; source: SkillSource }
  | { ok: false; reason: string };

export { landSkillDir, uninstallSkill, skillDirFor } from "./install-store";

/**
 * Narrow the validator's compat report to what the registry persists. The
 * validator reports `urls` as an egress hint for the admin's install-time trust
 * decision; `SkillEntry.compat` deliberately stores only `{ scripts, tools }`.
 * The subset is mapped here, once, rather than at each registry write site.
 */
export function toRegistryCompat(validation: ValidSkill): SkillCompat {
  return { scripts: [...validation.compat.scripts], tools: [...validation.compat.tools] };
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}

function isFile(target: string): boolean {
  try {
    return lstatSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * A zip almost always wraps the skill folder in a single directory (that is
 * what every "download as zip" produces), so descend into it when the archive
 * root holds exactly one directory and the manifest is inside it. Anything
 * else is returned as-is and the validator produces the reason.
 */
function resolveZipSkillRoot(dir: string): string {
  if (isFile(path.join(dir, SKILL_MANIFEST))) return dir;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return dir;
  }
  if (entries.length !== 1) return dir;
  const only = entries[0];
  if (only === undefined || !only.isDirectory()) return dir;
  const nested = path.join(dir, only.name);
  return isFile(path.join(nested, SKILL_MANIFEST)) ? nested : dir;
}

/** Strip any directory components an untrusted upload filename carries, on either separator. */
function safeUploadName(filename: string): string {
  const base = path.posix.basename(filename.replace(/\\/g, "/")).trim();
  return base === "" || base === "." || base === ".." ? "upload.zip" : base;
}

type LandOutcome = { ok: true } | { ok: false; reason: string };

async function claimAndLand(
  dir: string,
  slug: string,
  sourceType: PreflightSourceType,
): Promise<LandOutcome> {
  return withSkillSlugLock(slug, async () => {
    const preflight = preflightSlug(slug, sourceType);
    if (!preflight.ok) {
      return { ok: false, reason: preflightRefusalReason(slug, preflight.reason) };
    }
    landSkillDir(dir, slug);
    return { ok: true };
  });
}

export async function installFromGit(
  opts: { url: string; ref: string; subdir?: string },
  context: { sourceType: "git" | "marketplace" },
): Promise<InstallResult> {
  let staging: string;
  try {
    staging = makeStagingDir();
  } catch (error) {
    return { ok: false, reason: `could not create a staging directory: ${message(error)}` };
  }

  try {
    const fetched = await fetchGitSkill(opts, staging);
    if (!fetched.ok) return { ok: false, reason: fetched.reason };

    const validation = validateSkillDir(fetched.dir);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const landed = await claimAndLand(fetched.dir, validation.slug, context.sourceType);
    if (!landed.ok) return landed;
    return {
      ok: true,
      slug: validation.slug,
      validation,
      source: {
        type: "git",
        url: fetched.url,
        ref: fetched.ref,
        ...(fetched.subdir === undefined ? {} : { subdir: fetched.subdir }),
        commit: fetched.commit,
      },
    };
  } catch (error) {
    return { ok: false, reason: `install failed: ${message(error)}` };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function installFromZip(
  opts: { filename: string; data: Buffer },
  caps: Partial<ZipCaps> = {},
): Promise<InstallResult> {
  const limits: ZipCaps = { ...DEFAULT_ZIP_CAPS, ...caps };

  let staging: string;
  try {
    staging = makeStagingDir();
  } catch (error) {
    return { ok: false, reason: `could not create a staging directory: ${message(error)}` };
  }

  try {
    const extractDir = path.join(staging, "zip");
    mkdirSync(extractDir, { recursive: true, mode: SKILL_DIR_MODE });

    const extracted = extractSkillZip(opts.data, extractDir, limits);
    if (!extracted.ok) return { ok: false, reason: extracted.reason };

    const skillRoot = resolveZipSkillRoot(extractDir);
    const validation = validateSkillDir(skillRoot, {
      maxBytes: limits.maxBytes,
      maxFiles: limits.maxEntries,
    });
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const landed = await claimAndLand(skillRoot, validation.slug, "zip");
    if (!landed.ok) return landed;
    return {
      ok: true,
      slug: validation.slug,
      validation,
      source: { type: "zip", filename: safeUploadName(opts.filename) },
    };
  } catch (error) {
    return { ok: false, reason: `install failed: ${message(error)}` };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

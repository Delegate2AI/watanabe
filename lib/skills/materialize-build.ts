import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PLUGIN_NAME, PLUGIN_SKILLS_DIR, PLUGIN_VERSION } from "./materialize-key";
import { RESERVED_SKILL_SLUGS, SLUG_RE } from "./types";
import { SKILL_MANIFEST } from "./validate";

/**
 * Filesystem half of the per-clearance materializer (spec 34). Everything here
 * throws on failure; `materialize.ts` owns the never-throws boundary.
 */

/** Prefix for the staging directory, so a crashed process leaves something identifiable. */
export const STAGING_PREFIX = ".skills-materialize-";

const PLUGIN_MANIFEST_DIR = ".claude-plugin";
const PLUGIN_MANIFEST_FILE = "plugin.json";

/**
 * Path of a slug inside the store, re-checked at the point of use. The slug
 * comes from a registry file an admin edits by hand, and it is the only
 * caller-shaped component of a path that later gets symlinked or copied, so it
 * is validated here as well as in the loader. The containment check is belt and
 * braces on top of the character class: nothing matching `SLUG_RE` can contain
 * a separator or a dot segment in the first place.
 */
export function storeDirFor(storeDir: string, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`unsafe skill slug: "${slug}"`);
  if (RESERVED_SKILL_SLUGS.has(slug)) throw new Error(`reserved skill slug: "${slug}"`);
  const root = path.resolve(storeDir);
  const dir = path.resolve(root, slug);
  if (path.dirname(dir) !== root) throw new Error(`skill slug escapes the store: "${slug}"`);
  return dir;
}

/**
 * Whether the store actually holds a usable skill for this slug. The registry
 * loader deliberately does not stat the store, so a slug present in
 * `skills.yaml` but missing, half-written, or replaced by something that is not
 * a directory on disk is detected here and excluded rather than materialized
 * empty.
 *
 * `lstatSync`, never `statSync`: a symlink in the store would mean the store
 * was written by something other than the install pipeline (which refuses
 * them), and following it would put content from outside the store into a
 * session. Refused, not resolved.
 */
export function usableSkillDir(storeDir: string, slug: string): string | null {
  let dir: string;
  try {
    dir = storeDirFor(storeDir, slug);
  } catch {
    return null;
  }
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    if (!lstatSync(path.join(dir, SKILL_MANIFEST)).isFile()) return null;
  } catch {
    return null;
  }
  return dir;
}

/**
 * Whether an existing directory is exactly this plugin: the manifest is there,
 * every expected skill resolves, and `skills/` holds NOTHING ELSE.
 *
 * Exclusivity matters as much as presence. This is the only check between a
 * cached tree and a session, so a directory holding a superset of the caller's
 * slugs (a key collision, or a tampered tree) would put another clearance's
 * skill descriptions into the system prompt. Checking both directions makes the
 * boundary self-verifying instead of trusting the key alone.
 *
 * `existsSync` follows symlinks here, on purpose: a link whose store directory
 * was removed underneath it must read as incomplete.
 */
export function isCompletePlugin(pluginPath: string, slugs: string[]): boolean {
  if (!existsSync(path.join(pluginPath, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST_FILE))) return false;
  let present: string[];
  try {
    present = readdirSync(path.join(pluginPath, PLUGIN_SKILLS_DIR));
  } catch {
    return false;
  }
  const expected = new Set(slugs);
  if (present.length !== expected.size) return false;
  if (present.some((name) => !expected.has(name))) return false;
  return slugs.every((slug) => existsSync(path.join(pluginPath, PLUGIN_SKILLS_DIR, slug, SKILL_MANIFEST)));
}

/**
 * Link one store directory into the plugin. A symlink keeps the materialization
 * free and makes an in-place skill update visible without a rebuild. Filesystems
 * that refuse symlinks (some container overlays, Windows without the privilege)
 * fall back to a copy, which costs disk but keeps the session working.
 */
function linkSkill(target: string, link: string): void {
  try {
    symlinkSync(target, link, "dir");
  } catch {
    cpSync(target, link, { recursive: true });
  }
}

function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a finished staging tree onto the plugin path, displacing whatever was
 * there. A directory already at the path is renamed aside first rather than
 * deleted in place, so a session that is mid-read keeps a working tree and the
 * previous state can be put back if the landing fails. Same shape as the
 * installer's `landSkillDir`.
 *
 * The aside carries the staging prefix, so a crash between the two renames
 * leaves something the reaper already knows how to collect.
 */
function landPlugin(staging: string, pluginPath: string, slugs: string[]): void {
  const aside = path.join(path.dirname(pluginPath), `${STAGING_PREFIX}stale-${randomUUID()}`);
  const displaced = pathExists(pluginPath);
  if (displaced) renameSync(pluginPath, aside);
  try {
    try {
      renameSync(staging, pluginPath);
    } catch (error) {
      if (displaced) {
        try {
          renameSync(aside, pluginPath);
        } catch {
          // Another process took the name between the two renames. Its tree is
          // equivalent by construction, so there is nothing to restore.
        }
      }
      // Another process may have finished the identical build first. Its tree is
      // equivalent by construction (same key, same inputs), so adopt it.
      if (!isCompletePlugin(pluginPath, slugs)) throw error;
    }
  } finally {
    // No-op when the aside was renamed back. Never follows the symlinks inside.
    rmSync(aside, { recursive: true, force: true });
  }
}

/**
 * Build the plugin under a staging sibling and rename it into place, the same
 * atomic shape the install pipeline uses: a reader either sees no directory or
 * a complete one, never a half-linked tree.
 */
export function buildPluginDir(pluginPath: string, storeDir: string, slugs: string[]): void {
  const outDir = path.dirname(pluginPath);
  mkdirSync(outDir, { recursive: true });
  const staging = mkdtempSync(path.join(outDir, STAGING_PREFIX));
  try {
    mkdirSync(path.join(staging, PLUGIN_MANIFEST_DIR));
    writeFileSync(
      path.join(staging, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST_FILE),
      `${JSON.stringify({ name: PLUGIN_NAME, version: PLUGIN_VERSION }, null, 2)}\n`,
    );
    const skillsDir = path.join(staging, PLUGIN_SKILLS_DIR);
    mkdirSync(skillsDir);
    for (const slug of slugs) linkSkill(storeDirFor(storeDir, slug), path.join(skillsDir, slug));
    landPlugin(staging, pluginPath, slugs);
  } finally {
    // A no-op after a successful rename. `rmSync` unlinks symlinks rather than
    // recursing through them, so a failed build can never delete store content.
    rmSync(staging, { recursive: true, force: true });
  }
}

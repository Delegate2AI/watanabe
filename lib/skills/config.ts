import path from "node:path";
import { isFlagEnabled } from "@/lib/config/flags";
import { memoryWorktreeDir } from "@/lib/memory/config";

/**
 * Spec 34 installable Agent Skills. Off by default; flag-off leaves every
 * existing byte-path identical (no registry read, no plugin passed to the SDK,
 * the Skill tool stays denied, no admin links).
 */
export function isSkillsEnabled(): boolean {
  return isFlagEnabled("SKILLS_ENABLED");
}

/**
 * Where installed skill folders live, one directory per slug. Installed skill
 * content is app state rather than KB content, so it sits beside portal.db
 * under the `.data` root (same convention as lib/db/client.ts's dbPath).
 * Overridable via `PORTAL_SKILLS_DIR` so a deployment can point it at a
 * persistent volume.
 */
export function skillsStoreDir(): string {
  const configured = process.env.PORTAL_SKILLS_DIR?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.resolve(process.cwd(), ".data", "skills");
}

/**
 * Where per-clearance materialized SDK plugin directories are cached. Derived
 * from the store dir rather than configured separately, so a deployment that
 * moves the store onto a volume moves the (regenerable, symlink-bearing)
 * materializations with it: symlinks into the store only resolve if both roots
 * live on the same mount.
 */
export function skillsMaterializedDir(): string {
  const store = skillsStoreDir();
  return path.join(path.dirname(store), `${path.basename(store)}-materialized`);
}

/**
 * Default ceiling on what a single clone may write into the staging directory.
 *
 * `--depth=1` bounds history, not size: one commit of a repository holding tens
 * of gigabytes still transfers tens of gigabytes, and the validator's
 * `MAX_SKILL_BYTES` only applies AFTER the clone has landed on the same volume
 * as portal.db. Far above a plausible skill folder, because it has to cover a
 * whole repository's packfile and not just the subdirectory being installed.
 */
export const DEFAULT_MAX_CLONE_BYTES = 200_000_000;

/**
 * Default ceiling on entries in a clone. Directories cost a real block on disk
 * (around 4KB) while contributing nothing to a byte total, so a repository of a
 * million empty directories would pass a byte-only budget while filling the
 * volume. Set so its worst case lands near `DEFAULT_MAX_CLONE_BYTES`.
 */
export const DEFAULT_MAX_CLONE_ENTRIES = 50_000;

/**
 * Default ceiling on a zip upload body, enforced at the admin upload route.
 *
 * The route is the only place this CAN be enforced: `installFromZip` receives an
 * already-materialized Buffer, and adm-zip parses the whole central directory
 * before any per-entry cap applies, so without a limit here the ceiling is
 * whatever the HTTP layer happens to default to. Well above the validator's
 * `MAX_SKILL_BYTES` (10MB of extracted content), since a zip carries its own
 * overhead and the check is a coarse refusal, not the real content budget.
 */
export const DEFAULT_MAX_SKILL_UPLOAD_BYTES = 20_000_000;

/**
 * Ceiling on a JSON action body at `POST /api/admin/skills`.
 *
 * App Router handlers have no default body limit, so `request.json()` will
 * buffer whatever arrives. Every action this route accepts is a handful of
 * short strings plus a bounded group list, so the cap is small on purpose: it
 * is a refusal, not a budget.
 */
export const MAX_SKILL_ACTION_BODY_BYTES = 64_000;

/** The upload ceiling, read per call. Override: `PORTAL_SKILLS_MAX_UPLOAD_BYTES`. */
export function maxUploadBytes(): number {
  return envPositiveInt(process.env.PORTAL_SKILLS_MAX_UPLOAD_BYTES, DEFAULT_MAX_SKILL_UPLOAD_BYTES);
}

/**
 * Parse an env var into a finite positive number, else fall back. Same shape as
 * `lib/packages/config.ts`'s helper, so a malformed or empty value can never
 * poison a budget with `NaN` or a non-positive limit.
 */
function envPositiveInt(raw: string | undefined, fallback: number): number {
  const value = raw != null ? Number.parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The clone budget, read per call so a deployment can raise it without a code
 * change the first time a real skills monorepo trips it. Overrides:
 * `PORTAL_SKILLS_MAX_CLONE_BYTES`, `PORTAL_SKILLS_MAX_CLONE_ENTRIES`.
 */
export function cloneBudget(): { maxBytes: number; maxEntries: number } {
  return {
    maxBytes: envPositiveInt(process.env.PORTAL_SKILLS_MAX_CLONE_BYTES, DEFAULT_MAX_CLONE_BYTES),
    maxEntries: envPositiveInt(process.env.PORTAL_SKILLS_MAX_CLONE_ENTRIES, DEFAULT_MAX_CLONE_ENTRIES),
  };
}

/** Sibling of flags.yaml / groups.yaml / connectors.yaml in the memory worktree's access/ dir. */
export function skillsFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "skills.yaml");
}

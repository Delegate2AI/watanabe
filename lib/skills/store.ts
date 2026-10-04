import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml, stringify } from "yaml";
import { can } from "@/lib/authority/roles";
import { log } from "@/lib/log";
import { commitPrivateAccess } from "@/lib/repo-write-private-access";
import { skillsFilePath } from "./config";
import { uninstallSkill } from "./install-store";
import { invalidateMaterializedSkills } from "./materialize";
import { invalidateSkillRegistryCache, loadSkillRegistry } from "./registry";
import { sanitizeEntryInput } from "./store-input";
import {
  EntrySchema,
  RESERVED_SKILL_SLUGS,
  SLUG_RE,
  type SkillCompat,
  type SkillEntry,
  type SkillSource,
} from "./types";

/**
 * The admin write path for `access/skills.yaml` (spec 34), the same git-audited
 * private-access ref that `groups.yaml` / `roles.yaml` / `flags.yaml` /
 * `connectors.yaml` live on. Same shape as `lib/connectors/store.ts`:
 * capability check, apply to the raw map, serialize, reparse through the real
 * loader in a temp dir, then one commit through `commitPrivateAccess`.
 */
export const SKILLS_ACCESS_PATH = "access/skills.yaml";

export type SkillChange =
  | { verb: "add"; entry: SkillEntry }
  | { verb: "remove"; slug: string }
  | { verb: "setGroups"; slug: string; groups: string[] }
  | {
      verb: "update";
      slug: string;
      source: SkillSource;
      compat: SkillCompat;
      title?: string;
      groups?: string[];
    };

export type SkillWriteResult = { ok: true } | { ok: false; error: string };

export interface WriteSkillsOptions {
  /** Registry file to read the current state from. Test-only; production uses the real one. */
  filePath?: string;
  onBehalfOf?: string;
}

const PLAIN_ADDRESS_RE = /^[^\s<>@]+@[^\s<>@]+$/;

function attribution(onBehalfOf: string | undefined): {
  onBehalfOf?: { name: string; email: string };
} {
  const email = onBehalfOf?.trim().toLowerCase();
  if (email === undefined || !PLAIN_ADDRESS_RE.test(email)) return {};
  return { onBehalfOf: { name: email, email } };
}

/**
 * Slugs that pass SLUG_RE but resolve on `Object.prototype`, so assigning them
 * as a map key would not behave like an ordinary entry. `__proto__` is already
 * out (SLUG_RE admits no underscore); `prototype` is listed for symmetry.
 */
const UNSAFE_SLUGS = new Set(["constructor", "prototype"]);

type RawSkills = Record<string, unknown>;

/**
 * The current file as its raw slug map, entries untouched.
 *
 * Deliberately NOT rebuilt from `loadSkillRegistry().entries`: the loader drops
 * entries it cannot validate, so rebuilding from it would delete a colleague's
 * broken skill the moment any admin edited an unrelated one. Broken entries
 * ride through verbatim and keep showing up as disabled.
 *
 * Returns null when the file exists but is not the shape the loader accepts.
 * The caller refuses the write in that case rather than clobbering it.
 */
function readRawSkills(filePath: string): RawSkills | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    // No file yet is the normal state before the first skill is installed.
    return {};
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return null;
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  // The loader's top-level schema is strict, so a stray sibling key would make
  // it report a file-level error. Refuse rather than silently dropping the key.
  if (Object.keys(parsed).some((key) => key !== "skills")) return null;
  const skills = (parsed as { skills?: unknown }).skills;
  if (skills === null || skills === undefined) return {};
  if (typeof skills !== "object" || Array.isArray(skills)) return null;
  return { ...(skills as RawSkills) };
}

function serialize(skills: RawSkills): string {
  const sorted = Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b)));
  return stringify({ skills: sorted });
}

/** An existing raw entry as a field map. A non-map entry yields {} and fails the schema below. */
function fields(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

/**
 * The candidate entry a write arm proposes, before schema validation. `add`
 * requires the slug to be free; `setGroups` and `update` require it to be
 * taken, and edit the entry that is already there so a field neither verb
 * carries (a title, a pinned commit) is preserved rather than dropped.
 */
function proposed(
  change: Exclude<SkillChange, { verb: "remove" }>,
  slug: string,
  current: RawSkills,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (change.verb === "add") {
    if (Object.hasOwn(current, slug)) return { ok: false, error: "duplicate slug" };
    const { title, source, groups, compat } = change.entry;
    return { ok: true, value: { title, source, groups, compat } };
  }
  if (!Object.hasOwn(current, slug)) return { ok: false, error: "unknown skill" };
  const existing = fields(current[slug]);
  if (change.verb === "setGroups") return { ok: true, value: { ...existing, groups: change.groups } };
  const groups = change.groups === undefined ? {} : { groups: change.groups };
  // `title` is optional so an update that carries none keeps the recorded one.
  // A re-fetch whose frontmatter `name` changed passes the new one, which is
  // the only way the admin list stops showing a title upstream has abandoned.
  const title = change.title === undefined ? {} : { title: change.title };
  return {
    ok: true,
    value: { ...existing, ...title, ...groups, source: change.source, compat: change.compat },
  };
}

/**
 * The `writeAccess` reparse pattern: write the candidate to a temp dir, read it
 * back through the real loader, and refuse unless it yields exactly what this
 * change intended. Checking the rejected slugs as a set is the load-bearing
 * half: it pins them to exactly the pre-existing ones, so preserving a broken
 * entry cannot be turned into a way to smuggle a new one in.
 *
 * This leaves the loader's single cache slot pointing at the temp file, which
 * needs no explicit invalidation: the slot is keyed by path as well as mtime,
 * so any real read simply misses it and goes back to disk.
 */
function reparses(yamlText: string, entries: SkillEntry[], errorSlugs: string[]): boolean {
  const root = mkdtempSync(path.join(os.tmpdir(), "skills-validate-"));
  try {
    const file = path.join(root, "skills.yaml");
    writeFileSync(file, yamlText);
    const loaded = loadSkillRegistry(file);
    const loadedErrors = loaded.errors.map((error) => error.slug).sort((a, b) => a.localeCompare(b));
    return isDeepStrictEqual(loaded.entries, entries) && isDeepStrictEqual(loadedErrors, errorSlugs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Records one skill registry change on the private access ref.
 *
 * Refusals are returned, never thrown, so the route can translate them to a
 * reason code. The registry cache is invalidated only after the commit lands,
 * so a refused write never makes a session re-read the file for nothing.
 */
export async function writeSkills(
  change: SkillChange,
  actorEmail: string,
  options: WriteSkillsOptions = {},
): Promise<SkillWriteResult> {
  if (!can(actorEmail, "manageAccess")) return { ok: false, error: "forbidden" };

  const slug = (change.verb === "add" ? change.entry.slug : change.slug).trim();
  // Write arms only. A remove is gated by `Object.hasOwn` below instead, because
  // these guards constrain what an admin may WRITE, and applying them to a
  // removal makes the very entries this surface exists to fix (a hand-seeded
  // `kb:`, a `Legacy-Thing:`, an over-long slug) permanently undeletable: the
  // loader reports them as disabled rows, and nothing but a direct git commit
  // could clear them.
  if (change.verb !== "remove") {
    if (!SLUG_RE.test(slug) || UNSAFE_SLUGS.has(slug)) return { ok: false, error: "invalid slug" };
    if (RESERVED_SKILL_SLUGS.has(slug)) return { ok: false, error: "reserved slug" };
  }

  const filePath = options.filePath ?? skillsFilePath();
  const current = readRawSkills(filePath);
  if (current === null) return { ok: false, error: "skills file is unreadable" };

  const next: RawSkills = { ...current };
  const entries = loadSkillRegistry(filePath).entries.filter((entry) => entry.slug !== slug);
  if (change.verb === "remove") {
    if (!Object.hasOwn(current, slug)) return { ok: false, error: "unknown skill" };
    delete next[slug];
  } else {
    const candidate = proposed(change, slug, current);
    if (!candidate.ok) return candidate;
    // Hygiene before the schema, never instead of it: undefined keys dropped, a
    // nested `__proto__` or a cycle refused. Both refusals reuse the schema's
    // own error, since that is what the same input produced before this step.
    const sanitized = sanitizeEntryInput(candidate.value);
    if (!sanitized.ok) return { ok: false, error: "invalid skill entry" };
    const parsed = EntrySchema.safeParse(sanitized.value);
    if (!parsed.success) return { ok: false, error: "invalid skill entry" };
    next[slug] = parsed.data;
    entries.push({ slug, ...parsed.data });
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  const healthy = new Set(entries.map((entry) => entry.slug));
  const errorSlugs = Object.keys(next)
    .filter((key) => !healthy.has(key))
    .sort((a, b) => a.localeCompare(b));

  const yamlText = serialize(next);
  if (!reparses(yamlText, entries, errorSlugs)) {
    return { ok: false, error: "skill configuration failed validation" };
  }

  const author = actorEmail.trim().toLowerCase();
  const committed = await commitPrivateAccess(
    { [SKILLS_ACCESS_PATH]: yamlText },
    {
      authorName: author,
      authorEmail: author,
      message: `chore(access): ${change.verb} skill ${slug}`,
      ...attribution(options.onBehalfOf),
    },
  );
  if (!committed.ok) return { ok: false, error: committed.error };
  invalidateSkillRegistryCache();
  return { ok: true };
}

/**
 * The whole uninstall, which spec 34 defines as three things at once: the
 * registry entry goes, the store directory goes, and every materialized plugin
 * directory is dropped so no stale tree can still be handed to a session.
 *
 * Registry first, on purpose. If the store removal then fails, the leftover is
 * an orphaned directory nothing points at, which no lister and no materializer
 * will ever read. The other order would leave a registry entry pointing at
 * nothing, which shows in the admin list as a broken skill.
 *
 * The store removal is skipped for a slug the store could never have held (a
 * reserved or malformed key that only a hand-edit could have introduced), since
 * `skillDirFor` refuses to build a path from one. That keeps such an entry
 * removable from the registry, which is the whole point of the remove arm.
 */
export async function removeInstalledSkill(
  slug: string,
  actorEmail: string,
  options: WriteSkillsOptions = {},
): Promise<SkillWriteResult> {
  const key = slug.trim();
  const written = await writeSkills({ verb: "remove", slug: key }, actorEmail, options);
  if (!written.ok) return written;

  if (SLUG_RE.test(key) && !RESERVED_SKILL_SLUGS.has(key)) {
    try {
      uninstallSkill(key);
    } catch (error) {
      // The registry no longer lists it, so the skill is already gone as far as
      // every session is concerned. Not worth failing the admin action over.
      const message = error instanceof Error ? error.message : String(error);
      log.warn("skill store directory removal failed", { slug: key, err: message });
    }
  }
  invalidateMaterializedSkills();
  return { ok: true };
}

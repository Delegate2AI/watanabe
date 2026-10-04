import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { BOT_COMMITTER_EMAIL } from "@/lib/repo-write";
import { rollbackStoreDir, scrubReason } from "./admin-record";
import {
  boundedGroups,
  editableAuthoredEntry,
  humanAuthor,
  isAdmin,
  slugConflict,
  type AuthoredEntry,
} from "./authored-gate";
import { buildSkillManifest, manifestRev, parseSkillManifest } from "./authored-manifest";
import { errorText, stageManifest, validateStaged } from "./authored-stage";
import { authorGroups } from "./authors";
import { toRegistryCompat } from "./install";
import { landSkillDir, skillDirFor } from "./install-store";
import { invalidateMaterializedSkills } from "./materialize";
import { storeDirExists } from "./preflight";
import { slugifySkillName } from "./slugify";
import { withSkillSlugLock } from "./slug-lock";
import { writeSkills } from "./store";
import { RESERVED_SKILL_SLUGS, SLUG_RE, type SkillEntry } from "./types";
import { SKILL_MANIFEST } from "./validate";

export { authoredEditGate, mayEditEntry } from "./authored-gate";

export type AuthoredResult = { ok: true; slug: string } | { ok: false; error: string };

export type CreateAuthoredInput = {
  actorEmail: string;
  title: string;
  description: string;
  body: string;
  groups: string[];
};

export type UpdateAuthoredInput = {
  actorEmail: string;
  slug: string;
  title?: string;
  description?: string;
  body?: string;
  groups?: string[];
};

export type DeleteAuthoredInput = { actorEmail: string; slug: string };

export type AuthoredDeps = { land?: (dir: string, slug: string) => void };

function fail(error: string): AuthoredResult {
  return { ok: false, error };
}

function registryActor(email: string, admin: boolean): string {
  return admin ? email : BOT_COMMITTER_EMAIL;
}

export function currentManifest(
  slug: string,
): { ok: true; name: string; description: string; body: string } | { ok: false; error: string } {
  let raw: string;
  try {
    raw = readFileSync(path.join(skillDirFor(slug), SKILL_MANIFEST), "utf8");
  } catch (error) {
    return { ok: false, error: scrubReason(errorText(error)) };
  }
  const parsed = parseSkillManifest(raw);
  if (!parsed.ok) return { ok: false, error: "stored skill manifest is unreadable" };
  return parsed;
}

export async function createAuthoredSkill(
  input: CreateAuthoredInput,
  deps: AuthoredDeps = {},
): Promise<AuthoredResult> {
  try {
    const admin = isAdmin(input.actorEmail);
    if (!admin && authorGroups(input.actorEmail).length === 0) return fail("forbidden");
    const groups = boundedGroups(input.groups, input.actorEmail, admin);
    if (!groups.ok) return fail("invalid groups");

    const slug = slugifySkillName(input.title);
    if (slug === "" || !SLUG_RE.test(slug) || RESERVED_SKILL_SLUGS.has(slug)) {
      return fail("invalid slug");
    }
    return await withSkillSlugLock(slug, () =>
      runCreate(input, { slug, admin, groups: groups.groups }, deps),
    );
  } catch (error) {
    return fail(scrubReason(errorText(error)));
  }
}

async function runCreate(
  input: CreateAuthoredInput,
  context: { slug: string; admin: boolean; groups: string[] },
  deps: AuthoredDeps,
): Promise<AuthoredResult> {
  const { slug, admin } = context;
  const conflict = slugConflict(slug);
  if (conflict.kind === "taken") return fail(conflict.error);
  if (conflict.kind === "orphan") rollbackStoreDir(slug);

  const manifest = buildSkillManifest(input.title.trim(), input.description.trim(), input.body);
  const staged = stageManifest(manifest);
  if (!staged.ok) return fail(staged.error);
  try {
    const checked = validateStaged(staged.dir, slug);
    if (!checked.ok) return fail(checked.error);

    const author = humanAuthor(input.actorEmail);
    const entry: SkillEntry = {
      slug,
      title: checked.validation.name,
      source: { type: "authored", author, rev: manifestRev(manifest) },
      groups: context.groups,
      compat: toRegistryCompat(checked.validation),
    };
    const actor = registryActor(input.actorEmail, admin);
    const reserved = await writeSkills({ verb: "add", entry }, actor, { onBehalfOf: author });
    if (!reserved.ok) return fail(reserved.error);

    try {
      (deps.land ?? landSkillDir)(staged.dir, slug);
    } catch (error) {
      const rolledBack = await writeSkills({ verb: "remove", slug }, actor, { onBehalfOf: author });
      if (storeDirExists(slug)) rollbackStoreDir(slug);
      const landError = scrubReason(errorText(error));
      if (!rolledBack.ok) {
        return fail(
          scrubReason(`${landError}; the registry reservation may remain: ${rolledBack.error}`),
        );
      }
      return fail(landError);
    }
    invalidateMaterializedSkills();
    return { ok: true, slug };
  } finally {
    rmSync(staged.staging, { recursive: true, force: true });
  }
}

export async function updateAuthoredSkill(
  input: UpdateAuthoredInput,
  deps: AuthoredDeps = {},
): Promise<AuthoredResult> {
  try {
    return await withSkillSlugLock(input.slug, () => runUpdate(input, deps));
  } catch (error) {
    return fail(scrubReason(errorText(error)));
  }
}

async function runUpdate(input: UpdateAuthoredInput, deps: AuthoredDeps): Promise<AuthoredResult> {
  const admin = isAdmin(input.actorEmail);
  const gate = editableAuthoredEntry(input.actorEmail, input.slug, admin);
  if (!gate.ok) return fail(gate.error);
  const entry = gate.entry;

  const groups =
    input.groups === undefined ? null : boundedGroups(input.groups, input.actorEmail, admin);
  if (groups !== null && !groups.ok) return fail("invalid groups");

  const current = currentManifest(input.slug);
  if (!current.ok) return fail(current.error);
  const title = (input.title ?? current.name).trim();
  const description = (input.description ?? current.description).trim();
  const body = input.body ?? current.body;

  const manifest = buildSkillManifest(title, description, body);
  const staged = stageManifest(manifest);
  if (!staged.ok) return fail(staged.error);
  try {
    const checked = validateStaged(staged.dir, input.slug);
    if (!checked.ok) return fail(checked.error);

    const author = humanAuthor(input.actorEmail);
    const actor = registryActor(input.actorEmail, admin);
    const written = await writeSkills(
      {
        verb: "update",
        slug: input.slug,
        title: checked.validation.name,
        source: { type: "authored", author: entry.source.author, rev: manifestRev(manifest) },
        compat: toRegistryCompat(checked.validation),
        ...(groups === null || !groups.ok ? {} : { groups: groups.groups }),
      },
      actor,
      { onBehalfOf: author },
    );
    if (!written.ok) return fail(written.error);

    try {
      (deps.land ?? landSkillDir)(staged.dir, input.slug);
    } catch (error) {
      return fail(await restoreEntry(entry, actor, author, scrubReason(errorText(error))));
    }
    invalidateMaterializedSkills();
    return { ok: true, slug: input.slug };
  } finally {
    rmSync(staged.staging, { recursive: true, force: true });
  }
}

async function restoreEntry(
  entry: AuthoredEntry,
  actor: string,
  author: string,
  landError: string,
): Promise<string> {
  const restored = await writeSkills(
    {
      verb: "update",
      slug: entry.slug,
      title: entry.title,
      source: entry.source,
      compat: entry.compat,
      groups: entry.groups,
    },
    actor,
    { onBehalfOf: author },
  );
  if (restored.ok) return landError;
  return scrubReason(`${landError}; the registry entry may be ahead of the store: ${restored.error}`);
}

export async function deleteAuthoredSkill(input: DeleteAuthoredInput): Promise<AuthoredResult> {
  try {
    return await withSkillSlugLock(input.slug, () => runDelete(input));
  } catch (error) {
    return fail(scrubReason(errorText(error)));
  }
}

async function runDelete(input: DeleteAuthoredInput): Promise<AuthoredResult> {
  const admin = isAdmin(input.actorEmail);
  const gate = editableAuthoredEntry(input.actorEmail, input.slug, admin);
  if (!gate.ok) return fail(gate.error);

  const author = humanAuthor(input.actorEmail);
  const actor = registryActor(input.actorEmail, admin);
  const removed = await writeSkills({ verb: "remove", slug: input.slug }, actor, {
    onBehalfOf: author,
  });
  if (!removed.ok) return fail(removed.error);
  rollbackStoreDir(input.slug);
  if (storeDirExists(input.slug)) {
    return fail("skill removed from registry but its files could not be deleted; retry or contact an admin");
  }
  invalidateMaterializedSkills();
  return { ok: true, slug: input.slug };
}

import { z } from "zod";
import { MAX_COMPAT_ITEMS, MAX_COMPAT_ITEM_CHARS, TRUNCATION_SUFFIX } from "./compat";

/**
 * Cap on a persisted title. The install path derives a title from frontmatter
 * `name`, which the validator already caps, but access/skills.yaml is a
 * hand-editable file on the private access ref, so the schema is the more
 * direct exposure: a title that never went through the validator still lands in
 * the admin list and in the prompt of every session cleared for the skill.
 * Single source of truth for both, since ./validate.ts reads it from here
 * (types.ts cannot import back from validate.ts without a cycle).
 */
export const MAX_SKILL_TITLE_CHARS = 64;

/**
 * Caps on the persisted compat lists, sized around what ./compat.ts can emit
 * rather than around its raw numbers: `capList` appends one "+N more" marker
 * beyond the item cap, and `clip` appends TRUNCATION_SUFFIX beyond the
 * character cap. Setting these to MAX_COMPAT_ITEMS / MAX_COMPAT_ITEM_CHARS
 * would reject a report the validator itself produced.
 */
const MAX_PERSISTED_COMPAT_ITEMS = MAX_COMPAT_ITEMS + 1;
const MAX_PERSISTED_COMPAT_ITEM_CHARS = MAX_COMPAT_ITEM_CHARS + TRUNCATION_SUFFIX.length;

/**
 * Reserved internal names an installed skill can never take, mirroring spec
 * 33's connector rule so the two admin-installed namespaces stay consistent.
 */
export const RESERVED_SKILL_SLUGS: ReadonlySet<string> = new Set(["kb", "mem", "doc", "tasks"]);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Where the skill folder on disk came from, and what it is pinned to. `commit`
 * pins what the store actually holds, so drift between registry and store is
 * detectable and "update" is just a re-fetch plus a rewritten pin. Git-style
 * remotes are validated as non-empty strings rather than as URLs: `ssh://` and
 * `git@host:path` remotes are legitimate here and are not http(s) URLs.
 */
export const SourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("git"),
      url: z.string().min(1),
      ref: z.string().min(1),
      subdir: z.string().min(1).optional(),
      commit: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal("zip"), filename: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("marketplace"),
      index: z.string().min(1),
      name: z.string().min(1),
      url: z.string().min(1),
      subdir: z.string().min(1).optional(),
      commit: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("authored"),
      author: z.string().email(),
      rev: z.string().min(1),
    })
    .strict(),
]);

/**
 * Install-time compatibility report, informational only: executable helpers
 * found in the folder, and frontmatter allowed-tools this app cannot satisfy.
 * Both default to empty so an entry written before this field existed (or by
 * hand) still loads instead of failing closed on a purely advisory field.
 */
export const CompatSchema = z
  .object({
    scripts: compatList(),
    tools: compatList(),
  })
  .strict();

function compatList() {
  return z
    .array(z.string().min(1).max(MAX_PERSISTED_COMPAT_ITEM_CHARS))
    .max(MAX_PERSISTED_COMPAT_ITEMS)
    .default([]);
}

/** Per-skill schema. `groups` is spec 19 clearance and is required: fail closed. */
export const EntrySchema = z
  .object({
    title: z.string().min(1).max(MAX_SKILL_TITLE_CHARS),
    source: SourceSchema,
    groups: z.array(z.string().min(1)),
    compat: CompatSchema.default({ scripts: [], tools: [] }),
  })
  .strict();

/** Full `access/skills.yaml` shape, once every entry validates. */
export const FileSchema = z.object({ skills: z.record(z.string(), EntrySchema) }).strict();

export type SkillSource =
  | { type: "git"; url: string; ref: string; subdir?: string; commit: string }
  | { type: "zip"; filename: string }
  | {
      type: "marketplace";
      index: string;
      name: string;
      url: string;
      subdir?: string;
      commit: string;
    }
  | { type: "authored"; author: string; rev: string };

export type SkillCompat = { scripts: string[]; tools: string[] };

export type SkillEntry = {
  slug: string;
  title: string;
  source: SkillSource;
  groups: string[];
  compat: SkillCompat;
};

export type SkillRegistry = {
  entries: SkillEntry[];
  errors: Array<{ slug: string; reason: string }>;
};

import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { skillsFilePath } from "./config";
import {
  EntrySchema,
  RESERVED_SKILL_SLUGS,
  SLUG_RE,
  type SkillEntry,
  type SkillRegistry,
} from "./types";
import { describeZodError } from "./zod-error";

/**
 * Loose top-level shape check only: `skills` must be a plain map. Each value is
 * validated individually against EntrySchema below, so one malformed entry
 * never dooms the whole file (safeParse is all-or-nothing for the schema it is
 * called on, so the strict entry schema must NOT be nested here).
 */
const FileShapeSchema = z.object({ skills: z.record(z.string(), z.unknown()) }).strict();

const EMPTY_REGISTRY: SkillRegistry = { entries: [], errors: [] };

type CacheEntry = { path: string; mtimeMs: number; value: SkillRegistry };

/**
 * Single-slot cache, keyed by both the resolved path and mtime. Production only
 * ever calls this with skillsFilePath(), but the signature accepts an arbitrary
 * path (tests pass explicit temp-dir paths), so the slot must record which file
 * it holds: keying on mtimeMs alone would let two different paths that happen
 * to share an mtime silently return each other's parsed registry.
 */
let cache: CacheEntry | null = null;

/** Called after a committed access/skills.yaml change so the next read picks it up. */
export function invalidateSkillRegistryCache(): void {
  cache = null;
}

/**
 * Never-throws contract, like lib/connectors/registry.ts: a missing file, an
 * unreadable file, unparseable YAML, or a malformed entry all degrade into a
 * readable result rather than throwing into a session. Cached by path plus
 * mtime; an admin edit is picked up on the next load once
 * invalidateSkillRegistryCache() runs.
 */
export function loadSkillRegistry(filePath: string = skillsFilePath()): SkillRegistry {
  let mtimeMs: number;
  let raw: string;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
    raw = readFileSync(filePath, "utf8");
  } catch {
    // No skills.yaml yet is the common case (no admin has installed anything):
    // nothing is wrong, there are simply zero skills.
    return EMPTY_REGISTRY;
  }

  if (cache && cache.path === filePath && cache.mtimeMs === mtimeMs) return cache.value;

  const value = parseRegistry(raw);
  cache = { path: filePath, mtimeMs, value };
  return value;
}

function parseRegistry(raw: string): SkillRegistry {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return fileLevelError(error);
  }

  const shape = FileShapeSchema.safeParse(parsed);
  if (!shape.success) return fileLevelError(shape.error);

  const entries: SkillEntry[] = [];
  const errors: Array<{ slug: string; reason: string }> = [];

  for (const [slug, entryRaw] of Object.entries(shape.data.skills)) {
    if (!SLUG_RE.test(slug)) {
      errors.push({ slug, reason: "invalid slug: must match [a-z0-9][a-z0-9-]{0,31}" });
      continue;
    }
    if (RESERVED_SKILL_SLUGS.has(slug)) {
      errors.push({ slug, reason: `reserved slug: "${slug}" is an internal name` });
      continue;
    }
    const result = EntrySchema.safeParse(entryRaw);
    if (!result.success) {
      errors.push({ slug, reason: describeZodError(result.error) });
      continue;
    }
    entries.push({ slug, ...result.data });
  }

  return { entries, errors };
}

function fileLevelError(error: unknown): SkillRegistry {
  let reason: string;
  if (error instanceof z.ZodError) reason = describeZodError(error);
  else if (error instanceof Error) reason = error.message;
  else reason = String(error);
  return { entries: [], errors: [{ slug: "*", reason: reason.replace(/\s+/g, " ").trim() }] };
}

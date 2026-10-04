import { readFileSync, statSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { aliasesFilePath } from "./config";

/**
 * Identity alias registry: `access/aliases.yaml` on the private portal-memory
 * ref, beside `groups.yaml`. Maps a person's canonical portal email to the
 * other addresses they appear under in external systems (e.g. the personal
 * email Circleback records as a meeting attendee).
 *
 * This is clearance-relevant data, so per the people-directory design decision
 * ("two files, two failure domains") it deliberately does NOT live in
 * `access/people.yaml`, which is presentation-only.
 *
 * Shape:
 *   aliases:
 *     alice@example.com:
 *       - alice.personal@gmail.test
 */

const aliasesSchema = z.object({
  aliases: z.record(z.string().email(), z.array(z.string())),
});

/** alias email -> canonical email, all normalized. */
export type AliasIndex = Record<string, string>;

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailSchema = z.string().email();

/**
 * Loads the alias index. Never throws: a missing file is the normal state of a
 * fresh install and degrades to no aliases; a malformed file is logged and
 * degrades the same way. An alias that is not an email is dropped without
 * costing the rest of the file, and an alias that collides with a canonical
 * key is dropped so an alias can never shadow a real identity.
 */
export function loadAliasIndex(filePath: string = aliasesFilePath()): AliasIndex {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = aliasesSchema.parse(parse(raw));
    const canonicals = new Set(Object.keys(parsed.aliases).map(normalizedEmail));
    const index: AliasIndex = {};
    for (const [canonical, aliases] of Object.entries(parsed.aliases)) {
      for (const alias of aliases) {
        const normalized = normalizedEmail(alias);
        if (!emailSchema.safeParse(normalized).success) continue;
        if (canonicals.has(normalized)) continue;
        index[normalized] = normalizedEmail(canonical);
      }
    }
    return index;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authority] failed to load aliases from ${filePath}: ${message}`);
    return {};
  }
}

/** Resolves an email to its canonical identity; non-aliases pass through normalized. */
export function canonicalEmail(email: string, index: AliasIndex): string {
  const normalized = normalizedEmail(email);
  return index[normalized] ?? normalized;
}

type CacheEntry = { path: string; mtimeMs: number; size: number; value: AliasIndex };
let cache: CacheEntry | null = null;

/** Drops the cached index; call after a committed `access/aliases.yaml` change. */
export function invalidateAliasIndexCache(): void {
  cache = null;
}

/**
 * Cached `loadAliasIndex`, validated against the file's identity (path, mtime,
 * size) rather than held for the life of the process, exactly as
 * `lib/config/flags.ts` does for flag overrides and for the same reason: the
 * worktree is a git checkout, so something other than this process can move the
 * file underneath us.
 *
 * The cache is what makes canonicalization affordable on a hot path. Identity
 * resolution and the task queries run on every page render (`app/(app)/layout.tsx`
 * calls getForRequester), so an uncached read there would add a file read, a
 * YAML parse and a zod validation per render.
 *
 * Never throws, because `loadAliasIndex` never throws: a missing file caches an
 * empty index, which makes `canonicalEmail` an identity function and leaves
 * every caller behaving exactly as it did before aliases existed.
 */
export function aliasIndex(filePath: string = aliasesFilePath()): AliasIndex {
  let mtimeMs: number;
  let size: number;
  try {
    const stamp = statSync(filePath);
    mtimeMs = stamp.mtimeMs;
    size = stamp.size;
  } catch {
    cache = null;
    return {};
  }
  if (cache && cache.path === filePath && cache.mtimeMs === mtimeMs && cache.size === size) {
    return cache.value;
  }
  const value = loadAliasIndex(filePath);
  cache = { path: filePath, mtimeMs, size, value };
  return value;
}

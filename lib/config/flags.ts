import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { memoryWorktreeDir } from "@/lib/memory/config";
import { FLAG_NAMES } from "./flag-registry";

const flagsSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
}).strict();

export function flagsFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "flags.yaml");
}

/**
 * Reads and validates access/flags.yaml straight off disk, with no caching.
 * Unknown keys (e.g. a flag retired from FLAG_REGISTRY but still present in an
 * old commit) are dropped rather than failing the whole file: one stale key
 * must never silently revert every other override to its env default.
 */
export function loadFlagOverrides(
  filePath: string = flagsFilePath(),
): Partial<Record<string, boolean>> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    // No override file yet is the common case (nobody has used the admin UI),
    // not an error: nothing is overridden, every flag falls back to its env var.
    return {};
  }
  try {
    const flags = flagsSchema.parse(parse(raw)).flags;
    return Object.fromEntries(Object.entries(flags).filter(([name]) => FLAG_NAMES.has(name)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[config] failed to parse flag overrides from ${filePath}: ${message}`);
    return {};
  }
}

// isFlagEnabled() is called from every isXEnabled() leaf (17 flags across many
// call sites, including per-tool-call gates like lib/agent/permissions.ts's
// gateAgentTool), so a plain loadFlagOverrides() default parameter would mean a
// synchronous file read AND a YAML parse AND a zod validation on every single
// check. So the parsed result is cached, and the cache is validated against the
// file's identity (path, mtime, size) rather than held for the life of the
// process.
//
// This deliberately does LESS per call than the near-twin cache in
// lib/connectors/registry.ts, which stats and reads on every call and only
// skips the parse. That is affordable there because it is called once per
// session construction. Here the call frequency is per tool call, so this stats
// only, and reads exclusively when the stamp moved. Do not "align the twins" by
// adding a read back into this path.
//
// Why validate at all, when writeAccess already invalidates explicitly: the
// worktree is a git checkout, and something other than this process can move
// the file underneath us. ensureMemoryWorktree() runs `git reset --hard
// FETCH_HEAD`, and commitPrivateAccess rebases onto the remote before pushing,
// so a flags.yaml edited on the portal-memory branch directly (the GitLab web
// UI is enough) lands on disk with no call into this module. Held for the
// process lifetime, that value could never be picked up short of a restart.
type OverridesCache = {
  path: string;
  /** -1 for both stamp fields means "there was no file", itself a cacheable state. */
  mtimeMs: number;
  size: number;
  overrides: Partial<Record<string, boolean>>;
};

let cache: OverridesCache | null = null;

/**
 * The file's identity, or the absent-file sentinel. Cheap enough for the hot
 * path: one stat syscall, no read and no parse.
 *
 * Size is checked alongside mtime because a filesystem's timestamp granularity
 * is coarser than a fast rewrite. It narrows the window rather than closing it,
 * and it does not need to close it: the only writer that can rewrite this file
 * twice inside one timer tick is this process, which calls
 * invalidateFlagOverridesCache() on its own writes and so never depends on the
 * stamp. Out-of-band writers are git checkouts, which are many milliseconds
 * apart from any read at minimum.
 */
function stampOf(filePath: string): { mtimeMs: number; size: number } {
  try {
    const stats = statSync(filePath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return { mtimeMs: -1, size: -1 };
  }
}

function cachedFlagOverrides(): Partial<Record<string, boolean>> {
  const filePath = flagsFilePath();
  const { mtimeMs, size } = stampOf(filePath);
  if (cache && cache.path === filePath && cache.mtimeMs === mtimeMs && cache.size === size) {
    return cache.overrides;
  }
  const overrides = loadFlagOverrides(filePath);
  cache = { path: filePath, mtimeMs, size, overrides };
  return overrides;
}

/**
 * Called after a committed access/flags.yaml change so the next read picks it
 * up. Still worth calling even though the stamp check would catch the write on
 * its own: it makes this process's own write exact rather than dependent on
 * timestamp granularity.
 */
export function invalidateFlagOverridesCache(): void {
  cache = null;
}

export function isFlagEnabled(
  envVar: string,
  overrides?: Partial<Record<string, boolean>>,
): boolean {
  const resolved = overrides ?? cachedFlagOverrides();
  if (envVar in resolved) return resolved[envVar]!;
  return process.env[envVar] === "1";
}

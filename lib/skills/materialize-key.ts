import { createHash } from "node:crypto";
import type { SkillSource } from "./types";

/**
 * Identity of a materialized plugin directory (spec 34).
 *
 * The hash IS the access-control boundary: two callers land in the same
 * directory if and only if this function says they are equivalent, so every
 * input that can change what a caller may see has to be in it, and no two
 * distinct inputs may encode to the same string.
 *
 * The encoding is `JSON.stringify` of a structured payload rather than a
 * delimiter-joined string. A joined key is ambiguous the moment a group name
 * can contain the delimiter: clearance `["a", "b|c"]` and `["a|b", "c"]` both
 * flatten to `a|b|c`, which would hand one user another user's directory.
 * JSON escapes the quote and the backslash, so its array encoding is injective.
 */

export const PLUGIN_NAME = "watanabe-skills";
export const PLUGIN_VERSION = "1.0.0";

/**
 * The subdirectory a plugin holds its skills in, fixed by the SDK's local-plugin
 * layout: `<pluginPath>/skills/<slug>`. Named here rather than written literally
 * at each use, because `lib/skills/script-policy.ts` reads a slug back OUT of a
 * materialized path and must agree with what `materialize-build.ts` wrote.
 */
export const PLUGIN_SKILLS_DIR = "skills";

/** Bump when the on-disk plugin layout changes, so old directories are never reused. */
const KEY_VERSION = 1;

export type MaterializationKeyInput = {
  /** The caller's clearance groups, in any order, possibly with duplicates. */
  clearance: string[];
  /** Resolved path of the registry file, part of the key so two files cannot collide on mtime. */
  registryPath: string;
  registryMtimeMs: number;
  registrySize: number;
  /**
   * Resolved store root. In production it is fixed and derived from the same
   * config as the output root, but the materializer takes it as an option, and
   * two stores holding different content under the same slug must never share a
   * directory just because the registry and output root match.
   */
  storeDir: string;
  /** The entries that will actually be linked, in any order. */
  visible: Array<{ slug: string; source: SkillSource }>;
};

/**
 * Codepoint order, not `localeCompare`. Collation is ICU-locale sensitive, so
 * two app processes started with different `LANG` would sort identical inputs
 * differently and compute two keys for one clearance set.
 */
function byCodepoint(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * What the store holds for an entry. Spec 34 invalidates on "any pinned commit
 * changes", so the pin, not just the slug, is part of the identity. Zip
 * installs have no commit: the uploaded filename is the closest thing to a pin
 * they carry, and a re-upload under the same name is handled by the registry
 * file's own mtime moving.
 */
function pinOf(source: SkillSource): string {
  if (source.type === "zip") return `zip:${source.filename}`;
  if (source.type === "authored") return `authored:${source.rev}`;
  return `${source.type}:${source.commit}`;
}

export function materializationKey(input: MaterializationKeyInput): string {
  const clearance = [...new Set(input.clearance)].sort(byCodepoint);
  const visible = [...input.visible]
    .sort((a, b) => byCodepoint(a.slug, b.slug))
    .map((entry) => [entry.slug, pinOf(entry.source)]);

  const payload = JSON.stringify({
    v: KEY_VERSION,
    clearance,
    registry: [input.registryPath, input.registryMtimeMs, input.registrySize],
    store: input.storeDir,
    visible,
  });

  // 16 hex chars (64 bits) of a sha256. This names a cache directory, it is not
  // a secret or a signature: the inputs are all locally derived, so the only
  // risk is an accidental collision, and 64 bits is far past that for a
  // population of at most a few dozen distinct clearance sets.
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Guard for anything built from a key before it is removed or renamed onto. */
export function isMaterializationKey(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value);
}

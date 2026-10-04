import { readFileSync, statSync } from "node:fs";
import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";
import { designGuideFilePath, MAX_DESIGN_GUIDE_BYTES } from "./config";
import { checkDesignGuide } from "./validate";

/**
 * The house style in force, read from the private access ref.
 *
 * Never throws, and never returns nothing. It is called from the system-prompt
 * path, where an exception would take down a session and a blank answer would
 * produce the white-page-in-a-default-serif document the guidance exists to
 * prevent. A missing checkout, a missing file, an unreadable file and an empty
 * file all resolve to the constant the feature ships with.
 *
 * Cached by mtime like `lib/connectors/registry.ts`, and invalidated by the
 * write path, so an admin's save is visible on the next session without a
 * restart.
 */

export interface DesignGuide {
  text: string;
  /** Where `text` came from, so the admin surface can say "built-in" honestly. */
  source: "stored" | "default";
}

const SHIPPED: DesignGuide = { text: DEFAULT_DESIGN_HOUSE_STYLE, source: "default" };

type CacheEntry = { path: string; mtimeMs: number; value: DesignGuide };

/**
 * Single slot keyed by path AND mtime. Production only ever passes the real
 * path, but tests pass temp-dir paths, and keying on mtime alone would let two
 * files that happen to share one return each other's contents.
 */
let cache: CacheEntry | null = null;

/** Called after a committed access/design-guide.md change. */
export function invalidateDesignGuideCache(): void {
  cache = null;
}

export function loadDesignGuide(filePath: string = designGuideFilePath()): DesignGuide {
  let mtimeMs: number;
  let raw: string;
  try {
    const stat = statSync(filePath);
    // Read the size before the bytes: a file that grew past the ceiling after
    // it was committed (by hand on the ref, not through the admin surface) is
    // not something to load into every system prompt.
    if (stat.size > MAX_DESIGN_GUIDE_BYTES) return SHIPPED;
    mtimeMs = stat.mtimeMs;
    raw = readFileSync(filePath, "utf8");
  } catch {
    // No guide yet is the ordinary case: nobody has edited the built-in one.
    return SHIPPED;
  }

  if (cache && cache.path === filePath && cache.mtimeMs === mtimeMs) return cache.value;

  // Checked here as well as at the save route, because the file is on a git ref
  // and a commit made by hand never passed through a route. Guidance that
  // contradicts the constraints is worse than none: the shipped guide is the
  // safer answer either way.
  const value: DesignGuide = checkDesignGuide(raw).ok ? { text: raw.trim(), source: "stored" } : SHIPPED;
  cache = { path: filePath, mtimeMs, value };
  return value;
}

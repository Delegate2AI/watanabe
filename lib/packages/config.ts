import path from "node:path";
import { isKbWriteEnabled } from "@/lib/agent/permissions";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Config for the update-package intake subsystem. Requires BOTH its own flag
 * AND the portal-wide write kill switch (`isKbWriteEnabled()`): a package job
 * always ends in an MR submission via the write path (see
 * `lib/packages/runner.ts`), so enabling packages without write enabled would
 * let the upload route and queue accept jobs the agent has zero staging tools
 * to ever complete, burning budget on a run that can only fail.
 */
export function isPackagesEnabled(): boolean {
  return isFlagEnabled("PACKAGES_ENABLED") && isKbWriteEnabled();
}

/** Where uploaded packages land on disk. Overridable via PACKAGES_DATA_DIR; default /data/packages. */
export function packagesRoot(): string {
  const override = process.env.PACKAGES_DATA_DIR?.trim();
  return override ? path.resolve(process.cwd(), override) : "/data/packages";
}

/** Only safe path-segment characters, same shape as `lib/repo-write.ts`'s SAFE_ID: a package id is never trusted as a raw path component. */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * The on-disk directory an uploaded package's normalized files land in:
 * `<packagesRoot()>/<id>/package`. `id` comes from `crypto.randomUUID()`
 * upstream but is validated here anyway, defense in depth against any future
 * caller that doesn't generate it that way.
 */
export function packageDir(id: string): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(`refusing to build a package path from an unsafe id: "${id}"`);
  }
  return path.join(packagesRoot(), id, "package");
}

/**
 * Parse an env var into a finite POSITIVE number, else fall back to
 * `fallback`. Same shape as `lib/agent/config.ts`'s `envPositiveNumber`,
 * copied rather than imported (that helper is private to the agent config
 * module) so a malformed/empty env var can never poison an ingestion cap
 * with `NaN` or a non-positive limit.
 */
function envPositiveNumber(raw: string | undefined, parse: (s: string) => number, fallback: number): number {
  const value = raw != null ? parse(raw.trim()) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Total decompressed bytes allowed for one uploaded package (zip-bomb guard). Override via PACKAGES_MAX_TOTAL_BYTES. */
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

/** Decompressed bytes allowed for any single file within a package. Override via PACKAGES_MAX_FILE_BYTES. */
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Number of entries allowed in one uploaded zip. Override via PACKAGES_MAX_ENTRY_COUNT. */
const DEFAULT_MAX_ENTRY_COUNT = 500;

export function maxTotalBytes(): number {
  return envPositiveNumber(process.env.PACKAGES_MAX_TOTAL_BYTES, (s) => parseInt(s, 10), DEFAULT_MAX_TOTAL_BYTES);
}

export function maxFileBytes(): number {
  return envPositiveNumber(process.env.PACKAGES_MAX_FILE_BYTES, (s) => parseInt(s, 10), DEFAULT_MAX_FILE_BYTES);
}

export function maxEntryCount(): number {
  return envPositiveNumber(process.env.PACKAGES_MAX_ENTRY_COUNT, (s) => parseInt(s, 10), DEFAULT_MAX_ENTRY_COUNT);
}

/**
 * Hard budget/turn cutoffs for the background integration job that later
 * processes a normalized package (same rationale as `lib/agent/config.ts`'s
 * chat-session cutoffs, just sized for a longer, unattended run over a whole
 * document bundle rather than one interactive turn).
 */
const DEFAULT_MAX_BUDGET_USD = 5.0;
const DEFAULT_MAX_TURNS = 100;

export function packagesMaxBudgetUsd(): number {
  return envPositiveNumber(process.env.PACKAGES_MAX_BUDGET_USD, parseFloat, DEFAULT_MAX_BUDGET_USD);
}

export function packagesMaxTurns(): number {
  return envPositiveNumber(process.env.PACKAGES_MAX_TURNS, (s) => parseInt(s, 10), DEFAULT_MAX_TURNS);
}

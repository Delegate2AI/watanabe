import path from "node:path";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Config surface for the persistent-memory subsystem. Memory is committed to a
 * dedicated `portal-memory` branch in a second git worktree, deliberately
 * separate from the reset-prone read checkout (`lib/repo.ts`). This subsystem
 * gates on its OWN flag, independent of `KB_WRITE_ENABLED`: memory works
 * whether or not contributor content-editing is enabled, needing only
 * `REPO_WRITE_TOKEN` for push.
 */

/** The single source of truth for whether the memory subsystem is switched on. */
export function isMemoryEnabled(): boolean {
  return isFlagEnabled("MEMORY_ENABLED");
}

/** The parallel branch memory lives on. Never merged to main. */
export const MEMORY_BRANCH = "portal-memory";

/**
 * Where the `portal-memory` worktree is checked out. Overridable via
 * `MEMORY_CHECKOUT_DIR` (for local dev without a `/data` mount); defaults to
 * `/data/memory`, a sibling of the read checkout's `/data/repo`, so the two
 * never collide under the one PVC mount.
 */
export function memoryCheckoutDir(): string {
  const override = process.env.MEMORY_CHECKOUT_DIR?.trim();
  return override ? path.resolve(process.cwd(), override) : "/data/memory";
}

/** Alias kept explicit for callers that mean "the worktree root", not "a checkout dir". */
export function memoryWorktreeDir(): string {
  return memoryCheckoutDir();
}

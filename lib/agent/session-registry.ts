import { log } from "@/lib/log";
import type { AgentSession } from "./session";

/**
 * The warm-session registry and its LRU bookkeeping, split out of
 * `./session.ts` (file-size split; behavior unchanged).
 *
 * In-memory map of warm sessions, keyed by SDK session id. It does NOT need to
 * survive restarts: the SDK persists every session to disk, so a miss is healed
 * by resuming — a dev hot-reload or prod restart loses only the warm subprocess,
 * not the conversation.
 *
 * Pinned to globalThis: Next.js can bundle each route handler separately, so a
 * plain module-level `const` would give /api/agent/chat and
 * /api/agent/interrupt (etc.) DIFFERENT maps — the interrupt/context routes
 * would never find the session the streaming route is holding. One global map
 * fixes that (and also survives dev HMR). Harmless in prod (single process, one
 * instance anyway).
 */

/**
 * Hard cap on the number of warm in-memory sessions (one live CLI subprocess
 * each). Without it the `sessions` map grew unbounded — only the 6h idle timer
 * ever freed a subprocess, so a burst of distinct threads could pin arbitrarily
 * many subprocesses at once. At the cap, adding a new session first evicts the
 * least-recently-used one (see `rememberSession`). Eviction is non-destructive:
 * `dispose()` keeps the session on disk, so a later message resumes it
 * transparently. Configurable via AGENT_MAX_WARM_SESSIONS (default 50 — enough
 * concurrency for the KB portal, low enough to bound subprocess/memory use).
 */
const DEFAULT_MAX_WARM_SESSIONS = 50;

/** Parse an env var into a finite positive int, else fall back (never NaN). */
function envPositiveInt(raw: string | undefined, fallback: number): number {
  const value = raw != null ? parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const MAX_WARM_SESSIONS = envPositiveInt(
  process.env.AGENT_MAX_WARM_SESSIONS,
  DEFAULT_MAX_WARM_SESSIONS,
);

/**
 * Cap on the tiny `lastSessionCostUsd` map (one number per session id). It is
 * kept across evictions on purpose — a resumed subprocess counts its own cost
 * from zero, so it needs the prior total to continue rather than restart it (see
 * `carriedCostUsd`). That means it must NOT be cleared in `dispose()` (every
 * dispose here is an idle/LRU eviction, i.e. resume-able), so instead we bound
 * the map itself. Kept larger than the warm-session cap so a carried cost
 * survives several evict→resume cycles before it's pruned.
 */
export const MAX_COST_ENTRIES = MAX_WARM_SESSIONS * 4;

/**
 * Insert/refresh `session` under `key`, enforcing an LRU cap on `map`. Map
 * insertion order is used as recency: deleting then re-setting a key moves it to
 * the newest end, so the FIRST key is the least-recently-used victim. When the
 * cap is reached, the LRU entry is evicted via its `dispose()` (non-destructive)
 * before the new one is inserted. Exported for unit testing.
 */
export function rememberSession<T extends { dispose(): void }>(
  map: Map<string, T>,
  cap: number,
  key: string,
  session: T,
): void {
  map.delete(key); // drop any stale entry for this key first (also refreshes recency)
  while (map.size >= cap) {
    const oldestKey = map.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const victim = map.get(oldestKey);
    log.warn("evicting warm session (cap reached)", { sessionId: oldestKey, cap });
    map.delete(oldestKey);
    victim?.dispose();
  }
  map.set(key, session);
}

/**
 * Bounded LRU set for the numeric cost map — same insertion-order recency as
 * `rememberSession`, but values are plain numbers (no `dispose`, no eviction
 * log). Keeps `lastSessionCostUsd` from growing unbounded over process lifetime.
 * Exported for unit testing.
 */
export function rememberCost(
  map: Map<string, number>,
  cap: number,
  key: string,
  cost: number,
): void {
  map.delete(key);
  while (map.size >= cap) {
    const oldestKey = map.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
  map.set(key, cost);
}

/**
 * Refresh LRU recency for an existing key: re-set moves it to the newest end so
 * it's the last to be evicted when the warm-session cap is reached. No eviction
 * here — the entry count is unchanged, so the cap check is skipped.
 */
export function refreshRecency<T>(map: Map<string, T>, key: string): void {
  const value = map.get(key);
  if (value === undefined) return;
  map.delete(key);
  map.set(key, value);
}

const g = globalThis as unknown as {
  __agentChatSessions?: Map<string, AgentSession>;
  __agentChatLastCost?: Map<string, number>;
};

export const sessions: Map<string, AgentSession> = (g.__agentChatSessions ??= new Map());

// Last reported running cost per session id, so a resumed subprocess (which
// counts its own cost from zero) continues the total instead of restarting it.
export const lastSessionCostUsd: Map<string, number> = (g.__agentChatLastCost ??= new Map());

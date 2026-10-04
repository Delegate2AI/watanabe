/**
 * Registry-wide warm-session eviction, for a change that is not scoped to one
 * thread.
 *
 * `dropWarmSession` and `dropWarmSessionSoon` in `session.ts` each take a single
 * SDK session id, which is what the model-choice route and the per-thread
 * connector toggle need. A feature-flag write is a different shape: it changes
 * what EVERY live session may do. A session snapshots its connector grants and
 * its materialized skills plugin in its constructor, so without this an admin
 * turning `CONNECTORS_ENABLED` or `SKILLS_ENABLED` on left every already-warm
 * thread with no picker, no skills, and nothing on screen explaining why, until
 * idle eviction happened to rebuild it. The flag cache is invalidated on write
 * (`lib/config/flags.ts`), so a rebuilt session reads the new value.
 *
 * This reaches the same globalThis-pinned map `session.ts` owns rather than
 * importing it, so the core agent loop is untouched by the wiring. See the
 * comment above `__agentChatSessions` there for why that map is global: route
 * handlers can be bundled separately, so a module-level `const` would give
 * different callers different maps.
 */

interface EvictableSession {
  owner: string;
  evictWhenIdle: () => void;
}

const g = globalThis as unknown as {
  __agentChatSessions?: Map<string, EvictableSession>;
};

/**
 * Ask every warm session to rebuild on its next turn, deferring the ones that
 * are mid-turn rather than interrupting an answer a user is reading. Returns
 * how many sessions were asked.
 *
 * Never throws. It is called AFTER the write it reacts to has already been
 * committed, so a failure here must not turn a successful write into an error
 * response. A session that fails to evict keeps its stale snapshot, which is
 * the same state it would have had without this call.
 */
export function evictAllWarmSessions(): number {
  const sessions = g.__agentChatSessions;
  if (!sessions) return 0;
  // A snapshot, because `evictWhenIdle` on an idle session disposes it, and
  // dispose unregisters it from this very map.
  const warm = [...sessions.values()];
  for (const session of warm) {
    try {
      session.evictWhenIdle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[agent] failed to evict a warm session: ${message}`);
    }
  }
  return warm.length;
}

export function evictSessionsForOwner(email: string): number {
  const sessions = g.__agentChatSessions;
  if (!sessions) return 0;
  const warm = [...sessions.values()].filter((session) => session.owner === email);
  for (const session of warm) {
    try {
      session.evictWhenIdle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[agent] failed to evict a warm session for ${email}: ${message}`);
    }
  }
  return warm.length;
}

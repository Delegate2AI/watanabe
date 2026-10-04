import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { sessionStorageRoot } from "./transcript";
import { AgentSession } from "./session";
import { sessions } from "./session-registry";
import type { DocBinding } from "./copilot-prompt";
import type { OauthBearer } from "@/lib/connectors/types";
import type { ModelChoiceInput } from "./model-options";

/**
 * Module-level session factories and registry lookups, split out of
 * `./session.ts` (file-size split; behavior unchanged). All public names are
 * re-exported from `./session.ts`, so importers are unchanged.
 */

/**
 * Start a brand-new conversation, owned by `ownerEmail`. Registers itself
 * once the SDK id is known. `ownerName` (when the identity provider supplied
 * one) is used only as the write path's git commit author display name — see
 * `KbWriteContext`.
 */
export function createFreshSession(
  ownerEmail: string,
  ownerName?: string,
  docBinding?: DocBinding | null,
  pendingConnectorSlugs?: readonly string[],
  oauthBearer?: ReadonlyMap<string, OauthBearer>,
  modelChoice?: ModelChoiceInput | null,
): AgentSession {
  return new AgentSession(ownerEmail, undefined, ownerName, docBinding, pendingConnectorSlugs, oauthBearer, modelChoice);
}

/** Whether a session id actually exists in the on-disk SDK store. Unknown ids
 *  (a stale browser localStorage id, a session from another machine, or one that
 *  was cleaned) return false — `getSessionMessages` yields [] rather than throwing.
 *  Exported for the sessions route (spec 15 D32): an owned id whose transcript
 *  reads empty is only GONE when it's also cold in memory AND absent here —
 *  an in-flight first turn is empty-but-alive, and must not read as gone. */
export async function sessionExistsOnDisk(
  sdkSessionId: string,
  clearanceSet?: string[],
): Promise<boolean> {
  try {
    const messages = await getSessionMessages(sdkSessionId, {
      dir: sessionStorageRoot(sdkSessionId, clearanceSet),
    });
    return Array.isArray(messages) && messages.length > 0;
  } catch {
    return false;
  }
}

export async function isLiveSession(sdkSessionId: string, ownerEmail: string): Promise<boolean> {
  const existing = sessions.get(sdkSessionId);
  if (existing && !existing.isEnded) return true;
  return sessionExistsOnDisk(sdkSessionId, resolveClearanceForEmail(ownerEmail));
}

/**
 * Return the warm session for `sdkSessionId`, resume it from disk if it isn't in
 * memory (evicted, or lost to a restart/hot-reload), or — when the id doesn't
 * exist on disk at all — start a FRESH session instead of resuming.
 *
 * That last case is the important one: the browser persists its last session id
 * in localStorage, so a stale/dead id (old server instance, cleaned session)
 * would otherwise make the SDK resume fail every turn with "No conversation found
 * with session ID: …" — a chat that never answers. Falling back to a fresh
 * session lets the message go through. With `options.adoptSessionId` the fresh
 * session keeps the caller's own id (the SDK's `Options.sessionId`) instead of
 * minting a second one, so a pre-minted thread and its attachment directory
 * stay addressable from the first turn.
 *
 * Callers MUST authorize `sdkSessionId` against the thread store (see
 * lib/db/ownership.ts's `isOwnedBy`) before calling this — it trusts
 * `ownerEmail` and does not re-check who's allowed to resume what. The
 * `app/api/agent/route.ts` handler is the enforcement point.
 */
export interface ResumeOptions {
  modelChoice?: ModelChoiceInput | null;
  adoptSessionId?: string;
  pendingConnectorSlugs?: readonly string[];
}

const constructionsInFlight = new Map<string, Promise<AgentSession>>();

export function resumeOrGetSession(
  sdkSessionId: string,
  ownerEmail: string,
  ownerName?: string,
  docBinding?: DocBinding | null,
  oauthBearer?: ReadonlyMap<string, OauthBearer>,
  options?: ResumeOptions,
): Promise<AgentSession> {
  const existing = sessions.get(sdkSessionId);
  if (existing && !existing.isEnded) return Promise.resolve(existing);
  const started = constructionsInFlight.get(sdkSessionId);
  if (started) return started;
  const construction = constructSession(sdkSessionId, ownerEmail, ownerName, docBinding, oauthBearer, options);
  constructionsInFlight.set(sdkSessionId, construction);
  const forget = () => {
    constructionsInFlight.delete(sdkSessionId);
  };
  construction.then(forget, forget);
  return construction;
}

async function constructSession(
  sdkSessionId: string,
  ownerEmail: string,
  ownerName?: string,
  docBinding?: DocBinding | null,
  oauthBearer?: ReadonlyMap<string, OauthBearer>,
  options?: ResumeOptions,
): Promise<AgentSession> {
  const clearanceSet = resolveClearanceForEmail(ownerEmail);
  if (await sessionExistsOnDisk(sdkSessionId, clearanceSet)) {
    return new AgentSession(ownerEmail, sdkSessionId, ownerName, docBinding, undefined, oauthBearer);
  }
  return new AgentSession(ownerEmail, undefined, ownerName, docBinding, options?.pendingConnectorSlugs, oauthBearer, options?.modelChoice, options?.adoptSessionId);
}

/** In-memory lookup only (for resolving a live interrupt). */
export function getSession(sdkSessionId: string): AgentSession | undefined {
  return sessions.get(sdkSessionId);
}

/**
 * Drop a warm session so its NEXT turn reconstructs from disk, re-reading the
 * thread's stored model/effort override at construction (spec 24 model
 * switching). Called from the thread PATCH route after a successful choice
 * change, so a per-chat switch actually takes effect on the next turn instead of
 * waiting for idle eviction. Eviction is non-destructive: `dispose()` keeps the
 * session on disk, and `resumeOrGetSession` re-hydrates it with the new choice.
 *
 * A no-op when the session is cold (nothing warm to refresh) or currently BUSY:
 * disposing mid-turn would interrupt an in-flight turn, so a switch made while
 * the agent is answering applies on the following reconstruction rather than
 * killing the running turn. Returns whether a warm session was dropped.
 */
export function dropWarmSession(sdkSessionId: string): boolean {
  const session = sessions.get(sdkSessionId);
  if (!session || session.isBusy) return false;
  session.dispose();
  return true;
}

/**
 * Like `dropWarmSession`, but a BUSY session is scheduled to drop at the end of
 * its current turn instead of being left alone (see `evictWhenIdle`). Used by
 * the per-thread connector toggle, where dropping the eviction on the floor
 * would leave a disabled connector callable for the rest of the session.
 */
export function dropWarmSessionSoon(sdkSessionId: string): void {
  sessions.get(sdkSessionId)?.evictWhenIdle();
}

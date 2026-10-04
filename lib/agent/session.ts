import { randomUUID } from "node:crypto";
import { query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { titleFrom } from "@/lib/db/threads";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";
import type { ContextUsage, PermissionDecision } from "./events";
import { buildMemoryContextSync } from "@/lib/memory/recall";
import { consolidateThread } from "@/lib/memory/consolidate";
import type { ConnectorGrants } from "@/lib/connectors/grants";
import type { OauthBearer } from "@/lib/connectors/types";
import { buildOptions, type DocBinding, type ModelChoiceInput } from "./config";
import { createInputQueue } from "./session-input";
import { PermissionBroker } from "./session-permissions";
import { attachmentRootFor, resolveSessionSetup } from "./session-setup";
import { drainQuery } from "./session-drain";
import { bindDocThreadBestEffort, CostTracker, emitTurnResult, recordThreadBestEffort, runDirtyThreadBackstop } from "./session-turn";
import { MAX_WARM_SESSIONS, refreshRecency, rememberSession, sessions } from "./session-registry";

// Registry, factories, and LRU helpers live in sibling modules (size split).
export { rememberSession, rememberCost } from "./session-registry";
export {
  createFreshSession,
  sessionExistsOnDisk,
  isLiveSession,
  resumeOrGetSession,
  getSession,
  dropWarmSession,
  dropWarmSessionSoon,
} from "./session-factory";
import { SessionBroadcaster, type Subscriber } from "./session-broadcast";

/**
 * Evict an idle in-memory session this long after its last activity. Eviction
 * is non-destructive: the SDK keeps the session on disk, so the next message
 * transparently resumes it with full history.
 */
const SESSION_IDLE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * One long-lived KB chat conversation, keeping its subprocess warm across
 * turns (streaming-input mode). Its permission surface (deny-by-default gate
 * plus the `kb_submit` confirm tier) lives in `PermissionBroker`.
 */
export class AgentSession {
  /** Canonical id = the SDK's own session id (persisted to disk, resumable). */
  private _sdkSessionId: string | null;
  private readonly input = createInputQueue();
  private readonly query: Query;
  private readonly events = new SessionBroadcaster();
  private readonly costs: CostTracker;
  private readonly broker: PermissionBroker;
  private evictTimer: NodeJS.Timeout;
  /** True once the query loop ends (subprocess gone) — must resume, not reuse. */
  private ended = false;
  private registered: boolean;
  /** Set by `evictWhenIdle` when a turn is in flight; applied after the turn result. */
  private evictAfterTurn = false;

  /**
   * Whether a turn is in flight: set by `send()`, cleared on the turn result
   * or loop teardown. Read by the sessions route (spec 15 D34) to tell "still
   * working" from "idle". Per-process: a cold session correctly reads not busy.
   */
  private busy = false;
  /** The conversation's first user message — becomes its title in the registry. */
  private firstPrompt: string | null = null;
  /** The identity that owns this thread — set at creation, never reassigned. */
  private readonly ownerEmail: string;
  /** Display name for the owner, used as the commit author's name (write path). Set at creation, never reassigned. */
  private readonly ownerName?: string;
  private readonly clearanceSet: string[];
  private readonly authorityScopeRoot?: string;
  /**
   * A stable id generated at construction, the worktree key until the real
   * SDK session id arrives via `register()`; never read on a `resume`. A
   * worktree started under the placeholder would not be found under the real
   * id, but `register()` fires before any tool call in that first turn.
   */
  private readonly localFallbackId: string;
  /** External MCP connector grants for this thread (spec 33); EMPTY_GRANTS unless the flag is on. */
  private readonly connectorGrants: ConnectorGrants;
  /** The doc-copilot binding (spec 2026-08-27); null for an ordinary chat. The route validates it. */
  private readonly docBinding: DocBinding | null;

  /**
   * @param ownerEmail every SDK session id this instance adopts is recorded
   *   under this owner. Callers must authorize `resume` against the thread
   *   store first (lib/db/ownership.ts) — this class does not re-check.
   * @param resume SDK session id to resume from disk; omit for a new session.
   */
  constructor(ownerEmail: string, resume?: string, ownerName?: string, docBinding?: DocBinding | null, pendingConnectorSlugs?: readonly string[], oauthBearer?: ReadonlyMap<string, OauthBearer>, requestedChoice?: ModelChoiceInput | null, adoptSessionId?: string) {
    this.ownerEmail = ownerEmail;
    this.ownerName = ownerName;
    this.docBinding = docBinding ?? null;
    this.localFallbackId = adoptSessionId ?? randomUUID();
    const setup = resolveSessionSetup(ownerEmail, resume, this.localFallbackId, pendingConnectorSlugs, oauthBearer, requestedChoice, adoptSessionId);
    this.clearanceSet = setup.clearanceSet;
    this.authorityScopeRoot = setup.authorityScopeRoot;
    this.connectorGrants = setup.connectorGrants;
    this._sdkSessionId = adoptSessionId ?? resume ?? null;
    this.registered = resume !== undefined;
    this.costs = new CostTracker(setup.carriedCostUsd);
    const writeContext: KbWriteContext = {
      getThreadId: () => this.effectiveThreadId,
      ownerEmail: this.ownerEmail,
      ownerName: this.ownerName,
      scopeRoot: this.authorityScopeRoot,
    };
    this.broker = new PermissionBroker({
      getThreadId: () => this.effectiveThreadId,
      scopeRoot: this.authorityScopeRoot,
      attachmentRoot: () => attachmentRootFor(this.ownerEmail, this.effectiveThreadId),
      ownerEmail: this.ownerEmail,
      connectorAllow: setup.connectorGrants.allow,
      skillSlugs: setup.skillSlugs,
      broadcast: (event) => this.events.emit(event),
    });
    this.query = query({
      prompt: this.input.iterable,
      options: buildOptions(
        this.broker.preToolUse,
        this.broker.canUseTool,
        writeContext,
        resume,
        buildMemoryContextSync(this.ownerEmail, this.clearanceSet),
        this.clearanceSet,
        setup.modelChoice,
        setup.projectContext,
        Object.keys(setup.connectorGrants.servers).length > 0 ? setup.connectorGrants.servers : undefined,
        setup.skillsPlugin,
        this.docBinding,
        { adoptSessionId, attachmentDir: setup.attachmentDir },
      ),
    });
    const registeredId = adoptSessionId ?? resume;
    if (registeredId) rememberSession(sessions, MAX_WARM_SESSIONS, registeredId, this);
    this.evictTimer = setTimeout(() => this.dispose(), SESSION_IDLE_TTL_MS);
    void this.drain();
  }

  /** The SDK session id, once known. */
  get sdkId(): string | null {
    return this._sdkSessionId;
  }

  /** The write path's worktree key (`lib/repo-write.ts`): the SDK session id once known, else the placeholder. */
  private get effectiveThreadId(): string {
    return this._sdkSessionId ?? this.localFallbackId;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /** Whether a turn is in flight right now (spec 15 D34) — see `busy`'s doc. */
  get isBusy(): boolean {
    return this.busy && !this.ended;
  }

  get owner(): string {
    return this.ownerEmail;
  }

  subscribe(fn: Subscriber): () => void {
    return this.events.subscribe(fn);
  }

  /**
   * Push a user message; the agent processes it on its next turn.
   * `contextBlock` (spec 11) is prepended ahead of `text` in what the model
   * sees, but `this.firstPrompt` (the thread's title source) must stay tied
   * to the raw `text`, so a quoted excerpt never pollutes a thread's title.
   */
  send(text: string, contextBlock?: string): void {
    this.touch();
    this.busy = true;
    if (this.firstPrompt === null) this.firstPrompt = text;
    const fullText = contextBlock ? `${contextBlock}\n\n${text}` : text;
    this.input.push({
      type: "user",
      message: { role: "user", content: fullText },
      parent_tool_use_id: null,
    } as SDKUserMessage);
  }

  /**
   * Context-window usage via the SDK control request; null when the subprocess
   * is gone or the request fails — the caller renders "unknown", not an error.
   */
  async contextUsage(): Promise<ContextUsage | null> {
    if (this.ended) return null;
    try {
      const { totalTokens, maxTokens, percentage } = await this.query.getContextUsage();
      return { totalTokens, maxTokens, percentage };
    } catch {
      return null;
    }
  }

  /** Stop the current turn (the agent goes idle and awaits the next message). */
  async interrupt(): Promise<void> {
    try {
      await this.query.interrupt();
    } catch {
      /* already idle / no active turn — nothing to interrupt */
    }
  }

  /** Resolve a pending confirmation (caller verified ownership). Duplicates are a no-op — see `PermissionBroker.resolve`. */
  resolvePermission(requestId: string, decision: PermissionDecision): boolean {
    return this.broker.resolve(requestId, decision);
  }

  /**
   * Drop this session so its NEXT turn rebuilds from disk with freshly
   * resolved grants, deferring to end-of-turn when one is in flight (see
   * `dropWarmSessionSoon` in ./session-factory).
   */
  evictWhenIdle(): void {
    if (this.isBusy) {
      this.evictAfterTurn = true;
      return;
    }
    this.dispose();
  }

  dispose(): void {
    clearTimeout(this.evictTimer);
    // An eviction or shutdown must not leave a `canUseTool` promise dangling.
    this.broker.denyAll();
    // Fire-and-forget memory consolidation on idle/eviction. Self-guards on
    // MEMORY_ENABLED; a still-dirty thread is caught by register()'s backstop.
    if (this._sdkSessionId) {
      consolidateThread({
        sdkSessionId: this._sdkSessionId,
        ownerEmail: this.ownerEmail,
        ownerName: this.ownerName,
        clearance: this.clearanceSet,
      });
    }
    this.input.close();
    void this.query.interrupt().catch(() => {});
    if (this._sdkSessionId) sessions.delete(this._sdkSessionId);
  }

  /** First time we learn the SDK session id, adopt it as our registry key. */
  private register(sdkSessionId: string): void {
    this.registered = true;
    this._sdkSessionId = sdkSessionId;
    rememberSession(sessions, MAX_WARM_SESSIONS, sdkSessionId, this);
    // A doc-bound thread is titled for its document, and it must land on THIS
    // first recordThread: the upsert's COALESCE keeps the first non-null title.
    const title = this.docBinding ? `Copilot: ${this.docBinding.docTitle}` : this.firstPrompt ?? undefined;
    recordThreadBestEffort(sdkSessionId, this.ownerEmail, titleFrom(title));
    this.events.emit({ type: "session", sessionId: sdkSessionId });
    if (this.docBinding) bindDocThreadBestEffort(sdkSessionId, this.docBinding.docId, this.ownerEmail);
    runDirtyThreadBackstop(sdkSessionId, this.ownerEmail, this.ownerName, this.clearanceSet);
  }

  private touch(): void {
    clearTimeout(this.evictTimer);
    this.evictTimer = setTimeout(() => this.dispose(), SESSION_IDLE_TTL_MS);
    if (this._sdkSessionId) refreshRecency(sessions, this._sdkSessionId);
  }

  private drain(): Promise<void> {
    return drainQuery({
      query: this.query,
      sdkSessionId: () => this._sdkSessionId,
      hasRegistered: () => this.registered,
      adoptSessionId: (sid) => this.register(sid),
      connectorGrants: this.connectorGrants,
      broadcast: (event) => this.events.emit(event),
      onTurnResult: (msg) => this.handleTurnResult(msg),
      // Subprocess gone: deregister so the next message resumes from disk.
      onLoopEnd: () => {
        this.busy = false;
        this.ended = true;
        if (this._sdkSessionId) sessions.delete(this._sdkSessionId);
      },
    });
  }

  private handleTurnResult(msg: Extract<SDKMessage, { type: "result" }>): void {
    this.busy = false;
    emitTurnResult(msg, {
      sdkSessionId: this._sdkSessionId,
      ownerEmail: this.ownerEmail,
      costs: this.costs,
      broadcast: (event) => this.events.emit(event),
    });
    // A mid-turn eviction request applies once the turn's broadcasts landed.
    if (this.evictAfterTurn) this.dispose();
  }
}

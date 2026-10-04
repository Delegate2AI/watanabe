import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { getDb } from "@/lib/db/client";
import { bindDocThread } from "@/lib/db/doc-threads";
import { recordThread, markDirty, listDirtyForOwner } from "@/lib/db/threads";
import { isMemoryEnabled } from "@/lib/memory/config";
import { consolidateThread } from "@/lib/memory/consolidate";
import { log } from "@/lib/log";
import { captureUsage } from "@/lib/usage/capture";
import type { AgentEvent } from "./events";
import type { ConnectorGrants } from "@/lib/connectors/grants";
import { lastSessionCostUsd, MAX_COST_ENTRIES, rememberCost } from "./session-registry";
import type { ModelSnapshot } from "./usage-from-result";

/**
 * Per-turn bookkeeping for an `AgentSession`, split out of the class
 * (file-size split; behavior unchanged): cost accounting across resumes,
 * best-effort thread-registry writes, the dirty-thread consolidation
 * backstop, and the init-message connector notices.
 */

/**
 * Cumulative cost across evictions: `total_cost_usd` is the subprocess's own
 * cumulative total (counted from zero on a resume), the per-turn cost is the
 * delta since the last result, and the session total is the subprocess figure
 * plus whatever was carried across the resume.
 */
export class CostTracker {
  private subprocessCostUsd = 0;
  private sessionTotal: number;
  private snapshot: ModelSnapshot | null = null;

  constructor(private readonly carriedCostUsd: number) {
    this.sessionTotal = carriedCostUsd;
  }

  get sessionCostUsd(): number {
    return this.sessionTotal;
  }

  get modelSnapshot(): ModelSnapshot | null {
    return this.snapshot;
  }

  setModelSnapshot(next: ModelSnapshot | null): void {
    this.snapshot = next;
  }

  /** Apply one turn result; returns the turn's own cost. */
  applyResult(totalCostUsd: number | undefined): number {
    const cumulative = totalCostUsd ?? this.subprocessCostUsd;
    const turnCost = Math.max(0, cumulative - this.subprocessCostUsd);
    this.subprocessCostUsd = cumulative;
    this.sessionTotal = this.carriedCostUsd + cumulative;
    return turnCost;
  }
}

/**
 * Record ownership so "past chats" lists only this owner's threads, and the
 * resume-ownership check (lib/db/ownership.ts) can find it. Best effort — a DB
 * hiccup here must not break the turn already in flight, but it is no longer
 * silent: a swallowed recordThread failure permanently orphans the
 * conversation from "past chats" and the resume-ownership check.
 */
export function recordThreadBestEffort(sdkSessionId: string, ownerEmail: string, title: string | undefined): void {
  try {
    recordThread(getDb(), sdkSessionId, ownerEmail, title);
  } catch (e) {
    log.error("thread ownership DB write failed", {
      op: "recordThread",
      sessionId: sdkSessionId,
      err: String(e),
    });
  }
}

/**
 * Record a doc-copilot binding at register time (spec 2026-08-27), the same
 * best-effort posture as `recordThreadBestEffort`: a DB hiccup logs and never
 * fails the turn, but a lost binding means the panel cannot resume this
 * thread, so it is not silent.
 */
export function bindDocThreadBestEffort(threadId: string, docId: string, ownerEmail: string): void {
  try {
    bindDocThread(getDb(), threadId, docId, ownerEmail);
  } catch (e) {
    log.error("doc-thread binding DB write failed", {
      op: "bindDocThread",
      sessionId: threadId,
      err: String(e),
    });
  }
}

/**
 * Mark the thread un-consolidated: the turn's content is not yet in memory.
 * Cleared by consolidateThread's dream. Best-effort like the recordThread
 * write: a DB hiccup must NOT propagate into drain() and tear down a healthy
 * warm session.
 */
export function markDirtyBestEffort(sdkSessionId: string): void {
  if (!isMemoryEnabled()) return;
  try {
    markDirty(getDb(), sdkSessionId);
  } catch (e) {
    log.error("thread dirty-flag DB write failed", {
      op: "markDirty",
      sessionId: sdkSessionId,
      err: String(e),
    });
  }
}

/**
 * Dirty-thread backstop: consolidate any of this owner's threads left
 * un-dreamed by a prior crash or hard eviction, now, on their next session
 * start. Guarantees consolidation is unloseable even if dispose never ran.
 * The backstop only ever dreams THIS owner's threads, so this session's
 * clearance is the right scope for them.
 */
export function runDirtyThreadBackstop(
  currentSessionId: string,
  ownerEmail: string,
  ownerName: string | undefined,
  clearance: string[],
): void {
  if (!isMemoryEnabled()) return;
  try {
    for (const t of listDirtyForOwner(getDb(), ownerEmail)) {
      if (t.sdkSessionId !== currentSessionId) {
        consolidateThread({
          sdkSessionId: t.sdkSessionId,
          ownerEmail,
          ownerName,
          clearance,
        });
      }
    }
  } catch (err) {
    log.warn("dirty-thread backstop scan failed", { err: String(err) });
  }
}

/**
 * Spec 33: on the init message (once per subprocess), surface grant notices
 * and any granted connector the SDK could not start.
 */
export function broadcastInitNotices(
  mcpServers: Array<{ name: string; status: string }> | undefined,
  grants: ConnectorGrants,
  broadcast: (event: AgentEvent) => void,
): void {
  for (const text of grants.notices) broadcast({ type: "status", text });
  for (const server of mcpServers ?? []) {
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, and this
    // line runs on every session, including with both flags off.
    if (server.status !== "connected" && Object.hasOwn(grants.servers, server.name)) {
      broadcast({ type: "status", text: `Connector ${server.name} failed to start` });
    }
  }
}

/**
 * The turn-result bookkeeping: cost accounting, thread-registry bumps, the
 * structured per-turn log line (the operator's only visibility into per-turn
 * and cumulative spend), and the `turn_result` broadcast.
 */
export function emitTurnResult(
  msg: Extract<SDKMessage, { type: "result" }>,
  state: {
    sdkSessionId: string | null;
    ownerEmail: string;
    costs: CostTracker;
    broadcast: (event: AgentEvent) => void;
  },
): void {
  const turnCost = state.costs.applyResult(msg.total_cost_usd);
  const sessionCostUsd = state.costs.sessionCostUsd;
  const ok = msg.subtype === "success";
  const durationMs = msg.duration_ms ?? 0;
  if (state.sdkSessionId) {
    // Bounded LRU set: keep the running total for resume-carry without letting
    // the map grow unbounded over the process lifetime (see MAX_COST_ENTRIES).
    rememberCost(lastSessionCostUsd, MAX_COST_ENTRIES, state.sdkSessionId, sessionCostUsd);
    // Bump the thread's updatedAt so it sorts to the top of "recent". No new
    // title here (undefined) — recordThread keeps the existing one.
    recordThreadBestEffort(state.sdkSessionId, state.ownerEmail, undefined);
    markDirtyBestEffort(state.sdkSessionId);
  }
  log.info("turn complete", {
    sessionId: state.sdkSessionId,
    owner: state.ownerEmail,
    turnCostUsd: turnCost,
    sessionCostUsd,
    ok,
    durationMs,
  });
  const base = { type: "turn_result" as const, costUsd: turnCost, sessionCostUsd, durationMs };
  if (ok) {
    state.broadcast({ ...base, ok: true, result: msg.result });
  } else {
    state.broadcast({ ...base, ok: false, error: msg.errors?.join("; ") || msg.subtype });
  }
  try {
    state.costs.setModelSnapshot(
      captureUsage(
        msg,
        { source: "chat", ownerEmail: state.ownerEmail, threadId: state.sdkSessionId },
        state.costs.modelSnapshot,
      ),
    );
  } catch (err) {
    log.error("usage capture failed", { sessionId: state.sdkSessionId, err: String(err) });
  }
}

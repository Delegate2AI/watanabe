import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  HookCallback,
  PermissionResult,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, PermissionDecision } from "./events";
import { allowOutput, askOutput, denyOutput } from "./session-input";
import { denialReason, gateAgentTool, SUBMIT_TOOL } from "./permissions";
import { gatherAdvisoryFindings } from "@/lib/quality/gather";
import { isQualityGatesEnabled } from "@/lib/quality/config";

/**
 * How long a `kb_submit` confirmation waits for the thread owner to decide
 * before auto-denying. A `canUseTool` promise that never resolves would hold
 * the SDK subprocess's tool call open forever — this is the safety net (see
 * `PermissionBroker.canUseTool` below).
 */
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

/** What the broker needs from its session — a narrow seam, no class reference. */
export interface PermissionBrokerDeps {
  getThreadId(): string;
  scopeRoot: string | undefined;
  attachmentRoot(): string | undefined;
  ownerEmail: string;
  connectorAllow: ReadonlyMap<string, ReadonlySet<string> | "all">;
  skillSlugs: ReadonlySet<string>;
  broadcast(event: AgentEvent): void;
}

/**
 * The session's two SDK permission callbacks and the pending-confirmation
 * ledger behind them, split out of `AgentSession` (file-size split; behavior
 * unchanged). `preToolUse` is the deny-by-default gate; `canUseTool` handles
 * the SDK's `"ask"` control request for a `"confirm"`-gated tool by holding
 * the call open until `resolve` is called or the timeout auto-denies.
 */
export class PermissionBroker {
  /**
   * In-flight `kb_submit` confirmations, keyed by a UUID this class generates
   * itself (not the SDK's internal request id — `app/api/agent/permission/route.ts`
   * validates `requestId` as `z.string().uuid()`, so the format must be ours to
   * guarantee). Each entry's `resolve` completes the `canUseTool` promise the
   * SDK is blocked on; `timeout` is the `PERMISSION_TIMEOUT_MS` auto-deny.
   */
  private readonly pending = new Map<
    string,
    { resolve: (result: PermissionResult) => void; timeout: NodeJS.Timeout; input: Record<string, unknown> }
  >();

  constructor(private readonly deps: PermissionBrokerDeps) {}

  /**
   * The scope gate — runs before every tool call. See ./permissions for the
   * authoritative allow-list, path-scoping, and denial-reason wording; a
   * `"confirm"` verdict becomes the SDK's `"ask"` decision, which routes the
   * call to `canUseTool` below instead of deciding it here.
   */
  readonly preToolUse: HookCallback = async (input) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput;
    const verdict = gateAgentTool(
      tool_name,
      tool_input,
      this.deps.getThreadId(),
      this.deps.scopeRoot,
      this.deps.ownerEmail,
      this.deps.connectorAllow,
      this.deps.skillSlugs,
      this.deps.attachmentRoot(),
    );
    if (verdict === "allow") return allowOutput();
    if (verdict === "confirm") return askOutput();
    return denyOutput(denialReason(tool_name, tool_input, this.deps.scopeRoot, this.deps.attachmentRoot()));
  };

  /**
   * Handles the SDK's `"ask"` control request. Broadcasts a
   * `permission_request` event (the chat UI's `PermissionModal` renders on
   * this) and returns a promise that stays pending until `resolve` is called,
   * or `PERMISSION_TIMEOUT_MS` elapses and it auto-denies. kb_submit is the
   * only confirm-gated tool today, but the check is explicit rather than
   * assumed, so a future second "ask"-tier tool doesn't silently inherit a
   * kb_submit-scoped diff review. `gatherAdvisoryFindings` self-guards on the
   * quality-gates flag and never throws; the status broadcast before it is
   * cosmetic (a transient "checking quality" indicator), not a decision.
   */
  readonly canUseTool: CanUseTool = async (toolName, input) => {
    const requestId = randomUUID();
    if (toolName === SUBMIT_TOOL && isQualityGatesEnabled()) {
      this.deps.broadcast({ type: "status", text: "Checking submission quality…" });
    }
    const advisoryFindings =
      toolName === SUBMIT_TOOL
        ? await gatherAdvisoryFindings(this.deps.getThreadId(), this.deps.scopeRoot)
        : undefined;
    this.deps.broadcast({ type: "permission_request", requestId, toolName, input, advisoryFindings });
    return new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.resolve(requestId, "deny");
      }, PERMISSION_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timeout, input });
    });
  };

  /**
   * Resolve a pending confirmation. Returns `false` (a no-op) when `requestId`
   * isn't pending — already resolved, timed out, or never existed — so a
   * duplicate/late resolution (two browser tabs racing, or a resolve arriving
   * just after the timeout fired) can never double-resolve the same
   * `canUseTool` promise.
   *
   * `updatedInput` on the "allow" branch is REQUIRED, not optional, despite
   * the SDK's own `PermissionResult` type declaring it as `updatedInput?:` —
   * verified live: `{behavior: "allow"}` alone fails the SDK's actual runtime
   * Zod validation with "expected record, received undefined" at
   * `updatedInput`, which silently swallows the tool call entirely (the
   * confirmed submit never even starts running). Passing back the ORIGINAL
   * `input` unchanged is the correct semantic — "run the tool call as
   * proposed," not "run some different input."
   */
  resolve(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    this.deps.broadcast({ type: "permission_resolved", requestId, decision });
    pending.resolve(
      decision === "deny"
        ? { behavior: "deny", message: "Denied by the thread owner." }
        : { behavior: "allow", updatedInput: pending.input },
    );
    return true;
  }

  /**
   * Deny every in-flight confirmation. Called from `dispose()`: a `canUseTool`
   * promise that's never resolved would hold the SDK's tool call open forever,
   * so an eviction or shutdown must not leave one dangling.
   */
  denyAll(): void {
    for (const [requestId] of this.pending) {
      this.resolve(requestId, "deny");
    }
  }
}

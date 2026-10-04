import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AdvisoryFinding } from "@/lib/quality/agents";

// These cover the two unbounded-growth fixes in the warm-session registry
// (the sessions map is LRU-capped via dispose() at the cap; lastSessionCostUsd
// is bounded too) through the exported helpers with plain fakes, no CLI
// subprocess is spawned.
//
// The confirm-tier tests below DO construct a real AgentSession, so the SDK's
// `query()` and `./config`'s `buildOptions()` are mocked: `query()` returns a
// fake Query that never yields (parks forever, like an idle warm session;
// the drain loop just hangs harmlessly), and captures whatever `canUseTool`
// callback `AgentSession` wired into the options it built, so the tests can
// invoke that private callback the same way the SDK itself would.

type FakeQuery = AsyncIterable<never> & {
  interrupt: () => Promise<void>;
  getContextUsage: () => Promise<{ totalTokens: number; maxTokens: number; percentage: number }>;
};

function fakeQuery(): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      await new Promise<never>(() => {}); // never resolves — mirrors an idle warm session
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0, percentage: 0 }),
  };
}

type PreToolUseFn = (input: unknown) => Promise<unknown>;
type CapturedOptions = {
  canUseTool?: CanUseTool;
  preToolUse?: PreToolUseFn;
  cwd?: string;
  clearanceSet?: string[];
  writeContext?: { scopeRoot?: string };
};

let capturedCanUseTool: CanUseTool | undefined;
let capturedPreToolUse: PreToolUseFn | undefined;
let capturedWriteContext: { scopeRoot?: string } | undefined;
const queryMock = vi.fn((_opts: { options: CapturedOptions }) => {
  capturedCanUseTool = _opts.options.canUseTool;
  capturedPreToolUse = _opts.options.preToolUse;
  capturedWriteContext = _opts.options.writeContext;
  return fakeQuery();
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { options: { canUseTool?: CanUseTool; preToolUse?: PreToolUseFn } }) => queryMock(opts),
  getSessionMessages: vi.fn(),
}));

const resolveClearanceForEmailMock = vi.fn((email: string) =>
  email === "exec@example.com" ? ["all-hands", "exec"] : ["all-hands"],
);
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (email: string) => resolveClearanceForEmailMock(email),
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder default impl matching vaultRootFor's signature; each test overrides the return value via mockReturnValue.
const vaultRootForMock = vi.fn((_clearanceSet: string[]) => "/projection/scoped");
vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return { ...actual, vaultRootFor: (clearanceSet: string[]) => vaultRootForMock(clearanceSet) };
});

vi.mock("./config", () => ({
  buildOptions: (
    preToolUse: unknown,
    canUseTool: unknown,
    writeContext: unknown,
    resume?: string,
    memoryContext?: string,
    clearanceSet: string[] = ["all-hands"],
  ) => ({
    preToolUse,
    canUseTool,
    writeContext,
    resume,
    memoryContext,
    clearanceSet,
    cwd: clearanceSet.includes("exec") ? "/projection/exec" : "/projection/all-hands",
  }),
}));

// `canUseTool` (see session.ts) is supposed to call `gatherAdvisoryFindings`
// ONLY for the MCP-qualified submit tool name, so this is mocked (not the
// real diff/agent pipeline, already covered by lib/quality/gather.test.ts)
// purely to assert the WIRING: is it called for the right tool name, with
// the right findings ending up on the broadcast `permission_request` event.
const gatherAdvisoryFindingsMock = vi.fn(async (): Promise<AdvisoryFinding[]> => []);
vi.mock("@/lib/quality/gather", () => ({
  gatherAdvisoryFindings: (...args: [string, string?]) => gatherAdvisoryFindingsMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const recordThreadMock = vi.fn();
const titleFromMock = vi.fn((text?: string) => `title:${text ?? ""}`);
vi.mock("@/lib/db/threads", () => ({
  recordThread: (...args: unknown[]) => recordThreadMock(...args),
  titleFrom: (text?: string) => titleFromMock(text),
}));

const { AgentSession, rememberSession, rememberCost } = await import("./session");

/** A query that immediately reports a session id (triggering `register()`), then parks forever like an idle warm session. */
function fakeQueryWithSessionId(sessionId: string): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { session_id: sessionId } as never;
      await new Promise<never>(() => {});
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0, percentage: 0 }),
  };
}

/** A minimal, spec-complete `canUseTool` third argument (signal/toolUseID/requestId are the required fields). */
function toolCallOptions() {
  return { signal: new AbortController().signal, toolUseID: "tool-use-1", requestId: "sdk-request-1" };
}

type CapturedEvent = { type: string; [k: string]: unknown };
/** Subscribe and collect every broadcast event for a session, in order. */
function captureEvents(session: { subscribe: (fn: (e: unknown) => void) => unknown }): CapturedEvent[] {
  const events: CapturedEvent[] = [];
  session.subscribe((e) => events.push(e as CapturedEvent));
  return events;
}

/**
 * `canUseTool` now genuinely `await`s `gatherAdvisoryFindings` before
 * broadcasting for the submit tool (the bug this suite guards against was
 * exactly that await never happening), so a call no longer registers or
 * broadcasts synchronously. A macrotask tick flushes the mock's promise
 * chain (real timers only; fake timers are not enabled where this is used).
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type Fake = { id: string; dispose: () => void };
const fake = (id: string): Fake => ({ id, dispose: vi.fn() });

describe("rememberSession — LRU cap with dispose() eviction", () => {
  it("evicts the least-recently-used entry when a new one exceeds the cap", () => {
    const map = new Map<string, Fake>();
    const a = fake("a");
    const b = fake("b");
    const c = fake("c");
    rememberSession(map, 2, "a", a);
    rememberSession(map, 2, "b", b);
    rememberSession(map, 2, "c", c); // pushes past cap → evict oldest ("a")

    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(map.has("a")).toBe(false);
    expect([...map.keys()]).toEqual(["b", "c"]);
    expect(map.size).toBe(2);
  });

  it("treats a re-set as most-recently-used (so it is NOT the next victim)", () => {
    const map = new Map<string, Fake>();
    const a = fake("a");
    const b = fake("b");
    const c = fake("c");
    rememberSession(map, 2, "a", a);
    rememberSession(map, 2, "b", b);
    rememberSession(map, 2, "a", a); // refresh "a" → "b" is now the LRU
    rememberSession(map, 2, "c", c); // evicts "b", not "a"

    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(a.dispose).not.toHaveBeenCalled();
    expect([...map.keys()]).toEqual(["a", "c"]);
  });

  it("never grows past the cap across many inserts", () => {
    const map = new Map<string, Fake>();
    for (let i = 0; i < 100; i++) rememberSession(map, 5, `s${i}`, fake(`s${i}`));
    expect(map.size).toBe(5);
    expect([...map.keys()]).toEqual(["s95", "s96", "s97", "s98", "s99"]);
  });
});

describe("rememberCost — bounded cost map (no unbounded growth)", () => {
  it("keeps at most `cap` entries, pruning the oldest", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 50; i++) rememberCost(map, 10, `s${i}`, i);
    expect(map.size).toBe(10);
    expect([...map.keys()]).toEqual(["s40", "s41", "s42", "s43", "s44", "s45", "s46", "s47", "s48", "s49"]);
    // the surviving entries retain their carried cost value
    expect(map.get("s49")).toBe(49);
  });

  it("refreshes recency on re-set so a carried cost survives eviction pressure", () => {
    const map = new Map<string, number>();
    rememberCost(map, 2, "a", 1);
    rememberCost(map, 2, "b", 2);
    rememberCost(map, 2, "a", 10); // refresh "a" → "b" becomes LRU
    rememberCost(map, 2, "c", 3); // evicts "b"

    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(10);
    expect(map.get("c")).toBe(3);
  });
});

describe("AgentSession authority binding", () => {
  it("resolves owner clearance once and binds build options to its projection", () => {
    resolveClearanceForEmailMock.mockClear();
    queryMock.mockClear();
    const allHands = new AgentSession("user@example.com");
    expect(queryMock.mock.calls[0][0].options.cwd).toBe("/projection/all-hands");
    expect(queryMock.mock.calls[0][0].options.clearanceSet).toEqual(["all-hands"]);
    expect(resolveClearanceForEmailMock).toHaveBeenCalledTimes(1);
    allHands.dispose();

    resolveClearanceForEmailMock.mockClear();
    queryMock.mockClear();
    const exec = new AgentSession("exec@example.com");
    expect(queryMock.mock.calls[0][0].options.cwd).toBe("/projection/exec");
    expect(queryMock.mock.calls[0][0].options.clearanceSet).toEqual(["all-hands", "exec"]);
    expect(resolveClearanceForEmailMock).toHaveBeenCalledTimes(1);
    exec.dispose();
  });
});

describe("AgentSession — confirm tier (canUseTool / resolvePermission)", () => {
  beforeEach(() => {
    queryMock.mockClear();
    capturedCanUseTool = undefined;
  });

  it("resolvePermission is a no-op (returns false) for an unknown/already-resolved requestId", () => {
    const session = new AgentSession("alice@example.com");
    expect(session.resolvePermission("00000000-0000-0000-0000-000000000000", "allow")).toBe(false);
    session.dispose();
  });

  it("canUseTool broadcasts a permission_request and resolvePermission('allow') resolves it exactly once", async () => {
    const session = new AgentSession("alice@example.com");
    expect(capturedCanUseTool).toBeDefined();

    const events = captureEvents(session);

    const resultPromise = capturedCanUseTool!(
      "mcp__kb__kb_submit",
      { message: "add a section", slug: "add-section" },
      toolCallOptions(),
    );
    await flushMicrotasks();

    const request = events.find((e) => e.type === "permission_request") as
      | { type: "permission_request"; requestId: string; toolName: string }
      | undefined;
    expect(request).toBeDefined();
    expect(request!.toolName).toBe("mcp__kb__kb_submit");

    expect(session.resolvePermission(request!.requestId, "allow")).toBe(true);
    // A second resolution of the same request is a no-op — protects against a
    // double-confirm race (e.g. two browser tabs, or a resolve arriving just
    // after the timeout already fired).
    expect(session.resolvePermission(request!.requestId, "allow")).toBe(false);

    const result = (await resultPromise) as PermissionResult;
    expect(result.behavior).toBe("allow");
    // Required by the SDK's actual runtime validation despite `updatedInput?:`
    // being optional in its own .d.ts — `{behavior:"allow"}` alone fails with
    // a ZodError ("expected record, received undefined") that silently
    // swallows the tool call before it ever runs. Must echo back the
    // ORIGINAL input, unchanged.
    expect(result).toMatchObject({
      behavior: "allow",
      updatedInput: { message: "add a section", slug: "add-section" },
    });

    const resolvedEvent = events.find((e) => e.type === "permission_resolved");
    expect(resolvedEvent).toEqual({ type: "permission_resolved", requestId: request!.requestId, decision: "allow" });

    session.dispose();
  });

  it("resolvePermission('deny') resolves canUseTool with behavior: deny", async () => {
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);

    const resultPromise = capturedCanUseTool!("mcp__kb__kb_submit", {}, toolCallOptions());
    await flushMicrotasks();
    const request = events.find((e) => e.type === "permission_request") as { requestId: string };

    expect(session.resolvePermission(request.requestId, "deny")).toBe(true);
    const result = (await resultPromise) as PermissionResult;
    expect(result.behavior).toBe("deny");

    session.dispose();
  });

  it("auto-denies after the confirmation timeout if the owner never decides", async () => {
    vi.useFakeTimers();
    const session = new AgentSession("alice@example.com");
    try {
      const resultPromise = capturedCanUseTool!("mcp__kb__kb_submit", {}, toolCallOptions());
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      const result = (await resultPromise) as PermissionResult;
      expect(result.behavior).toBe("deny");
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it("dispose() flushes any still-pending confirmation as denied, so it never hangs forever", async () => {
    const session = new AgentSession("alice@example.com");
    const resultPromise = capturedCanUseTool!("mcp__kb__kb_submit", {}, toolCallOptions());
    await flushMicrotasks(); // let the pending confirmation actually register before disposing
    session.dispose();
    const result = (await resultPromise) as PermissionResult;
    expect(result.behavior).toBe("deny");
  });
});

// Regression coverage: `canUseTool`'s guard used to compare against the bare
// `"kb_submit"`, but the SDK always calls it with the MCP-qualified name
// `"mcp__kb__kb_submit"` (SUBMIT_TOOL, ./permissions), so it never matched
// and `gatherAdvisoryFindings` never ran. Drives `canUseTool` with the
// qualified name, as the SDK does, and checks the wiring end to end.
describe("AgentSession: advisory findings wiring (canUseTool -> gatherAdvisoryFindings)", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    queryMock.mockClear();
    capturedCanUseTool = undefined;
    gatherAdvisoryFindingsMock.mockClear();
    gatherAdvisoryFindingsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  // `canUseTool` is invoked directly (bypassing the preToolUse gate that would
  // only ever route kb_submit here) so the guard itself is what's isolated.
  it("calls gatherAdvisoryFindings only for the qualified submit name, attaching its result to the event", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const findings: AdvisoryFinding[] = [{ agent: "citation-checker", severity: "warn", message: "unsourced figure" }];
    gatherAdvisoryFindingsMock.mockResolvedValue(findings);
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);

    const otherPromise = capturedCanUseTool!("mcp__kb__kb_diff", {}, toolCallOptions());
    const otherRequest = events.find((e) => e.type === "permission_request") as { requestId: string };
    expect(gatherAdvisoryFindingsMock).not.toHaveBeenCalled();
    session.resolvePermission(otherRequest.requestId, "allow");
    await otherPromise;

    const submitPromise = capturedCanUseTool!("mcp__kb__kb_submit", { message: "add a section" }, toolCallOptions());
    await flushMicrotasks();
    const request = events.filter((e) => e.type === "permission_request").at(-1) as {
      requestId: string;
      advisoryFindings?: AdvisoryFinding[];
    };
    expect(request.advisoryFindings).toEqual(findings);
    expect(gatherAdvisoryFindingsMock).toHaveBeenCalledTimes(1);

    session.resolvePermission(request.requestId, "allow");
    await submitPromise;
    session.dispose();
  });

  it("broadcasts a status event before the permission_request, when quality gates are on", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);

    const submitPromise = capturedCanUseTool!("mcp__kb__kb_submit", { message: "add a section" }, toolCallOptions());
    await flushMicrotasks();

    const statusIndex = events.findIndex((e) => e.type === "status");
    const requestIndex = events.findIndex((e) => e.type === "permission_request");
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(requestIndex);

    const request = events[requestIndex] as { requestId: string };
    session.resolvePermission(request.requestId, "allow");
    await submitPromise;
    session.dispose();
  });

  it("does not broadcast a status event when quality gates are off", async () => {
    delete process.env.QUALITY_GATES_ENABLED;
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);

    const submitPromise = capturedCanUseTool!("mcp__kb__kb_submit", {}, toolCallOptions());
    await flushMicrotasks();

    expect(events.some((e) => e.type === "status")).toBe(false);

    const request = events.find((e) => e.type === "permission_request") as { requestId: string };
    session.resolvePermission(request.requestId, "allow");
    await submitPromise;
    session.dispose();
  });

  // gatherAdvisoryFindings self-guards on the flag, so it still runs but
  // resolves to [] here, same as the real implementation would.
  it("attaches no advisory findings when quality gates are off, even for the submit tool", async () => {
    delete process.env.QUALITY_GATES_ENABLED;
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);
    const resultPromise = capturedCanUseTool!("mcp__kb__kb_submit", {}, toolCallOptions());
    await flushMicrotasks();
    const request = events.find((e) => e.type === "permission_request") as { requestId: string; advisoryFindings?: AdvisoryFinding[] };
    expect(request.advisoryFindings).toEqual([]);
    session.resolvePermission(request.requestId, "allow");
    await resultPromise;
    session.dispose();
  });
});

describe("AgentSession: authorityScopeRoot threading", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    queryMock.mockClear();
    capturedCanUseTool = undefined;
    capturedWriteContext = undefined;
    vaultRootForMock.mockClear();
    vaultRootForMock.mockReturnValue("/projection/scoped");
    gatherAdvisoryFindingsMock.mockClear();
    gatherAdvisoryFindingsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("passes authorityScopeRoot as gatherAdvisoryFindings' second argument when authority is on", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    process.env.AUTHORITY_ENABLED = "1";
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);

    const submitPromise = capturedCanUseTool!("mcp__kb__kb_submit", { message: "add a section" }, toolCallOptions());
    await flushMicrotasks();
    const request = events.find((e) => e.type === "permission_request") as { requestId: string };

    expect(gatherAdvisoryFindingsMock).toHaveBeenCalledWith(expect.any(String), "/projection/scoped");

    session.resolvePermission(request.requestId, "allow");
    await submitPromise;
    session.dispose();
  });

  it("passes undefined as the scopeRoot when authority is off", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    delete process.env.AUTHORITY_ENABLED;
    const session = new AgentSession("alice@example.com");
    const events = captureEvents(session);

    const submitPromise = capturedCanUseTool!("mcp__kb__kb_submit", { message: "add a section" }, toolCallOptions());
    await flushMicrotasks();
    const request = events.find((e) => e.type === "permission_request") as { requestId: string };

    expect(gatherAdvisoryFindingsMock).toHaveBeenCalledWith(expect.any(String), undefined);

    session.resolvePermission(request.requestId, "allow");
    await submitPromise;
    session.dispose();
  });

  it("threads authorityScopeRoot into the writeContext passed to buildOptions", () => {
    process.env.AUTHORITY_ENABLED = "1";
    const session = new AgentSession("alice@example.com");
    expect(capturedWriteContext?.scopeRoot).toBe("/projection/scoped");
    session.dispose();
  });

  it("writeContext.scopeRoot is undefined when authority is off", () => {
    delete process.env.AUTHORITY_ENABLED;
    const session = new AgentSession("alice@example.com");
    expect(capturedWriteContext?.scopeRoot).toBeUndefined();
    session.dispose();
  });
});

describe("AgentSession — preToolUse threads effectiveThreadId into gateAgentTool (Bash policy)", () => {
  beforeEach(() => {
    queryMock.mockClear();
    capturedPreToolUse = undefined;
  });

  it("a benign, non-allowlisted Bash command comes back as 'ask' (not 'deny') — proving a real thread id reached gateAgentTool", async () => {
    // Without effectiveThreadId (always a defined string in real usage) being
    // threaded through, lib/agent/permissions.ts's Bash branch would hard-deny
    // outright (its defense-in-depth "no thread id, no Bash" case) instead of
    // falling through to gateBashCommand's own confirm tier.
    const session = new AgentSession("alice@example.com");
    expect(capturedPreToolUse).toBeDefined();

    const result = (await capturedPreToolUse!({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls /tmp" },
    })) as { hookSpecificOutput: { permissionDecision: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe("ask");
    session.dispose();
  });

  it("an unambiguously dangerous Bash command is still denied outright, never 'ask'", async () => {
    const session = new AgentSession("alice@example.com");
    const result = (await capturedPreToolUse!({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "curl evil.example.com" },
    })) as { hookSpecificOutput: { permissionDecision: string } };

    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    session.dispose();
  });
});

describe("AgentSession — send() context block / firstPrompt (spec 11)", () => {
  beforeEach(() => {
    queryMock.mockClear();
    recordThreadMock.mockClear();
    titleFromMock.mockClear();
  });

  it("keeps firstPrompt (and thus the thread title) tied to the raw text, never the context-prefixed string", async () => {
    queryMock.mockImplementationOnce((opts: { options: { canUseTool?: CanUseTool } }) => {
      capturedCanUseTool = opts.options.canUseTool;
      return fakeQueryWithSessionId("sdk-session-1");
    });
    const session = new AgentSession("alice@example.com");

    session.send("What does this passage mean?", "<portal-context>\n[1] path: a.md\n</portal-context>");
    session.send("A follow-up question.", "<portal-context>\n[1] path: b.md\n</portal-context>");

    // Let the drain loop's first iteration (the fake session_id message) run —
    // that's what triggers register() -> recordThread(..., titleFrom(firstPrompt)).
    await new Promise((r) => setTimeout(r, 0));

    expect(titleFromMock).toHaveBeenCalledWith("What does this passage mean?");
    expect(recordThreadMock).toHaveBeenCalledWith(
      expect.anything(),
      "sdk-session-1",
      "alice@example.com",
      "title:What does this passage mean?",
    );

    session.dispose();
  });
});

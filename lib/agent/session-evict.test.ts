import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `dropWarmSessionSoon` and the deferred eviction behind it (spec 33 review).
 *
 * `dropWarmSession` is a no-op on a BUSY session, which is right for a model
 * preference that can wait and wrong for a capability revocation: the connector
 * toggle ignored its `false` return, so disabling a connector while the
 * assistant was streaming left the warm session holding its old connected
 * server and allow map for the rest of its life, while the database and the
 * picker both showed the connector off.
 *
 * The SDK is mocked exactly as session-skills.test.ts mocks it, except the fake
 * query is drivable: a turn is started, a result message is pushed, and the
 * assertions are about WHEN the session is torn down.
 */

type Pushable = AsyncIterable<unknown> & {
  push: (message: unknown) => void;
  interrupt: () => Promise<void>;
  getContextUsage: () => Promise<{ totalTokens: number; maxTokens: number; percentage: number }>;
};

const interruptMock = vi.fn();

function drivableQuery(): Pushable {
  const queued: unknown[] = [];
  let wake: (() => void) | null = null;
  return {
    push(message: unknown) {
      queued.push(message);
      wake?.();
    },
    [Symbol.asyncIterator]: async function* () {
      for (;;) {
        while (queued.length > 0) yield queued.shift();
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    interrupt: () => {
      interruptMock();
      return Promise.resolve();
    },
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0, percentage: 0 }),
  };
}

let live: Pushable;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => live,
  getSessionMessages: vi.fn(),
}));

vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: () => ["all-hands"],
}));

vi.mock("./config", () => ({
  buildOptions: (...args: unknown[]) => ({ preToolUse: args[0], canUseTool: args[1] }),
}));

vi.mock("@/lib/quality/gather", () => ({ gatherAdvisoryFindings: vi.fn(async () => []) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/db/threads", () => ({
  recordThread: vi.fn(),
  titleFrom: (text?: string) => `title:${text ?? ""}`,
}));

const { AgentSession, dropWarmSessionSoon, getSession } = await import("./session");

/** A minimal SDK result message: enough for `emitTurnResult` to run end to end. */
function resultMessage(sessionId: string) {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    result: "done",
    total_cost_usd: 0,
    duration_ms: 1,
  };
}

/** Let the drain loop's async iterator pick up whatever was just pushed. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  interruptMock.mockReset();
  live = drivableQuery();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dropWarmSessionSoon", () => {
  it("drops an idle warm session immediately, like dropWarmSession does", async () => {
    const session = new AgentSession("owner@example.com", "s-idle");
    await settle();

    dropWarmSessionSoon("s-idle");

    expect(interruptMock).toHaveBeenCalledTimes(1);
    expect(getSession("s-idle")).toBeUndefined();
    session.dispose();
  });

  it("defers a BUSY session's eviction to the end of the turn instead of dropping it", async () => {
    const session = new AgentSession("owner@example.com", "s-busy");
    await settle();
    session.send("hello");
    expect(session.isBusy).toBe(true);

    dropWarmSessionSoon("s-busy");

    // Still live: tearing the subprocess down mid-turn would interrupt the
    // answer the user is currently reading.
    expect(interruptMock).not.toHaveBeenCalled();
    expect(getSession("s-busy")).toBe(session);

    live.push(resultMessage("s-busy"));
    await settle();

    // The turn finished, so the eviction it was holding is applied: the NEXT
    // turn reconstructs from disk and re-resolves connector grants.
    expect(interruptMock).toHaveBeenCalledTimes(1);
    expect(getSession("s-busy")).toBeUndefined();
  });

  it("leaves a session alone when no eviction was ever requested", async () => {
    const session = new AgentSession("owner@example.com", "s-quiet");
    await settle();
    session.send("hello");

    live.push(resultMessage("s-quiet"));
    await settle();

    expect(interruptMock).not.toHaveBeenCalled();
    expect(getSession("s-quiet")).toBe(session);
    session.dispose();
  });

  it("is a no-op for a session id nothing warm is holding", () => {
    expect(() => dropWarmSessionSoon("s-cold")).not.toThrow();
    expect(interruptMock).not.toHaveBeenCalled();
  });
});

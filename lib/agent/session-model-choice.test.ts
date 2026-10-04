// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

type FakeQuery = AsyncIterable<unknown> & { interrupt: () => Promise<void> };

function parkedQuery(): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      await new Promise<never>(() => {});
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
}

function queryWithSessionId(sessionId: string): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { session_id: sessionId };
      await new Promise<never>(() => {});
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
}

let nextQuery: () => FakeQuery = parkedQuery;
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => nextQuery(),
  getSessionMessages: vi.fn(),
}));

vi.mock("@/lib/identity/resolve", () => ({ resolveClearanceForEmail: () => ["all-hands"] }));
vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return { ...actual, vaultRootFor: () => "/projection/all-hands" };
});

const buildOptionsMock = vi.fn((...args: unknown[]) => {
  void args;
  return {};
});
vi.mock("./config", () => ({ buildOptions: (...args: unknown[]) => buildOptionsMock(...args) }));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const order: string[] = [];
const recordThreadMock = vi.fn(() => {
  order.push("recordThread");
});
const getThreadModelChoiceMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  recordThread: (...args: unknown[]) => recordThreadMock(...(args as [])),
  getThreadModelChoice: (...args: unknown[]) => getThreadModelChoiceMock(...args),
  titleFrom: (text?: string) => (text ?? "New chat").slice(0, 80),
}));

const { AgentSession } = await import("./session");

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  buildOptionsMock.mockClear();
  recordThreadMock.mockClear();
  getThreadModelChoiceMock.mockReset().mockReturnValue(null);
  order.length = 0;
  nextQuery = parkedQuery;
});

describe("AgentSession requested model choice", () => {
  it("forwards a requested choice to buildOptions as the seventh argument on a fresh session", () => {
    const session = new AgentSession(
      "bob@example.com",
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      {
        model: "claude-fable-5-1",
        effort: "max",
      },
    );
    expect(buildOptionsMock.mock.calls[0][6]).toEqual({
      model: "claude-fable-5-1",
      effort: "max",
    });
    session.dispose();
  });

  it("passes null when no choice was requested", () => {
    const session = new AgentSession("bob@example.com");
    expect(buildOptionsMock.mock.calls[0][6]).toBeNull();
    expect(getThreadModelChoiceMock).not.toHaveBeenCalled();
    session.dispose();
  });

  it("ignores a requested choice on a resume and reads the thread row instead", () => {
    getThreadModelChoiceMock.mockReturnValue({ model: "claude-sonnet-5", effort: "low" });
    const session = new AgentSession(
      "bob@example.com",
      "sdk-1",
      undefined,
      null,
      undefined,
      undefined,
      {
        model: "claude-fable-5-1",
        effort: "max",
      },
    );
    expect(getThreadModelChoiceMock).toHaveBeenCalledWith({}, "sdk-1");
    expect(buildOptionsMock.mock.calls[0][6]).toEqual({
      model: "claude-sonnet-5",
      effort: "low",
    });
    session.dispose();
  });

  it("prefers the choice stored on an ADOPTED pre-minted row over the request body", () => {
    getThreadModelChoiceMock.mockReturnValue({ model: "claude-sonnet-5", effort: "low" });
    const session = new AgentSession(
      "bob@example.com",
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      { model: "claude-fable-5-1", effort: "max" },
      "premint-1",
    );
    expect(getThreadModelChoiceMock).toHaveBeenCalledWith({}, "premint-1");
    expect(buildOptionsMock.mock.calls[0][6]).toEqual({
      model: "claude-sonnet-5",
      effort: "low",
    });
    session.dispose();
  });

  it("applies the request body when the adopted row stores no override", () => {
    getThreadModelChoiceMock.mockReturnValue({ model: null, effort: null });
    const session = new AgentSession(
      "bob@example.com",
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      { model: "claude-fable-5-1", effort: "max" },
      "premint-1",
    );
    expect(buildOptionsMock.mock.calls[0][6]).toEqual({
      model: "claude-fable-5-1",
      effort: "max",
    });
    session.dispose();
  });

  it("fills the fields an adopted row leaves empty from the request body", () => {
    getThreadModelChoiceMock.mockReturnValue({ model: null, effort: "low" });
    const session = new AgentSession(
      "bob@example.com",
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      { model: "claude-fable-5-1", effort: "max" },
      "premint-1",
    );
    expect(buildOptionsMock.mock.calls[0][6]).toEqual({
      model: "claude-fable-5-1",
      effort: "low",
    });
    session.dispose();
  });

  it("degrades to no choice when the thread-row read throws", () => {
    getThreadModelChoiceMock.mockImplementation(() => {
      throw new Error("db gone");
    });
    const session = new AgentSession("bob@example.com", "sdk-1");
    expect(buildOptionsMock.mock.calls[0][6]).toBeNull();
    session.dispose();
  });
});

describe("AgentSession register order", () => {
  it("records the thread row before it announces the session id", async () => {
    nextQuery = () => queryWithSessionId("sdk-1");
    const session = new AgentSession("bob@example.com");
    session.subscribe((event) => {
      if (event.type === "session") order.push("broadcast");
    });
    session.send("hello");
    await flush();

    expect(order).toEqual(["recordThread", "broadcast"]);
    session.dispose();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelChoiceInput } from "./model-options";

type FakeQuery = AsyncIterable<never> & {
  interrupt: () => Promise<void>;
  getContextUsage: () => Promise<{ totalTokens: number; maxTokens: number; percentage: number }>;
};

function fakeQuery(): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      await new Promise<never>(() => {});
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0, percentage: 0 }),
  };
}

type CapturedOptions = {
  resume?: string;
  sessionId?: string;
  modelChoice?: ModelChoiceInput | null;
  extras?: { adoptSessionId?: string; attachmentDir?: string };
};

let capturedOptions: CapturedOptions | undefined;
const queryMock = vi.fn((opts: { options: CapturedOptions }) => {
  capturedOptions = opts.options;
  return fakeQuery();
});

function sessionIdQuery(sessionId: string): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { session_id: sessionId } as never;
      await new Promise<never>(() => {});
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0, percentage: 0 }),
  };
}

const getSessionMessagesMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { options: CapturedOptions }) => queryMock(opts),
  getSessionMessages: (...a: unknown[]) => getSessionMessagesMock(...a),
}));

vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: () => ["all-hands"],
}));

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return { ...actual, vaultRootFor: () => "/projection/all-hands" };
});

vi.mock("./config", () => ({
  buildOptions: (
    preToolUse: unknown,
    canUseTool: unknown,
    writeContext: unknown,
    resume?: string,
    memoryContext?: string,
    clearanceSet?: string[],
    modelChoice?: ModelChoiceInput | null,
    projectContext?: string,
    connectorServers?: unknown,
    skillsPlugin?: unknown,
    docBinding?: unknown,
    extras?: { adoptSessionId?: string; attachmentDir?: string },
  ) => ({
    resume,
    modelChoice,
    extras,
    ...(extras?.adoptSessionId ? { sessionId: extras.adoptSessionId } : {}),
  }),
}));

vi.mock("@/lib/quality/gather", () => ({ gatherAdvisoryFindings: async () => [] }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const recordThreadMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  recordThread: (...args: unknown[]) => recordThreadMock(...args),
  getThreadModelChoice: () => null,
  titleFrom: (text?: string) => `title:${text ?? ""}`,
}));

const { resumeOrGetSession } = await import("./session-factory");
const { sessions } = await import("./session-registry");

const PREMINTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXISTING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  sessions.clear();
  queryMock.mockClear();
  getSessionMessagesMock.mockReset();
  recordThreadMock.mockReset();
  capturedOptions = undefined;
});

describe("resumeOrGetSession, adopting a pre-minted id", () => {
  it("adopts an owned id that has no transcript on disk", async () => {
    getSessionMessagesMock.mockResolvedValue([]);
    const session = await resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
      adoptSessionId: PREMINTED,
    });
    expect(session.sdkId).toBe(PREMINTED);
    expect(capturedOptions?.sessionId).toBe(PREMINTED);
    expect(capturedOptions?.resume).toBeUndefined();
  });

  it("registers the adopted id at construction, so a second POST reuses the same session", async () => {
    getSessionMessagesMock.mockResolvedValue([]);
    const first = await resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
      adoptSessionId: PREMINTED,
    });
    const second = await resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
      adoptSessionId: PREMINTED,
    });
    expect(second).toBe(first);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("still resumes an id that IS on disk, never adopting over a real transcript", async () => {
    getSessionMessagesMock.mockResolvedValue([{ type: "user" }]);
    await resumeOrGetSession(EXISTING, "alice@example.com", undefined, undefined, undefined, {
      adoptSessionId: EXISTING,
    });
    expect(capturedOptions?.resume).toBe(EXISTING);
    expect(capturedOptions?.sessionId).toBeUndefined();
  });

  it("applies the request's model choice on the adopt branch (no transcript means a fresh session)", async () => {
    getSessionMessagesMock.mockResolvedValue([]);
    await resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
      adoptSessionId: PREMINTED,
      modelChoice: { model: "claude-opus-4-8", effort: "high" },
    });
    expect(capturedOptions?.modelChoice).toEqual({ model: "claude-opus-4-8", effort: "high" });
  });

  it("constructs one session when two first turns race on the same pre-minted id", async () => {
    getSessionMessagesMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0));
      return [];
    });
    const [first, second] = await Promise.all([
      resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
        adoptSessionId: PREMINTED,
      }),
      resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
        adoptSessionId: PREMINTED,
      }),
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("mints a new session when no adopt id is given", async () => {
    getSessionMessagesMock.mockResolvedValue([]);
    const session = await resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {});
    expect(session.sdkId).toBeNull();
    expect(capturedOptions?.sessionId).toBeUndefined();
    expect(capturedOptions?.resume).toBeUndefined();
  });
});

describe("an adopted session still titles its pre-minted row", () => {
  it("records the thread with the first prompt's title on the first SDK message", async () => {
    getSessionMessagesMock.mockResolvedValue([]);
    queryMock.mockImplementationOnce((opts: { options: CapturedOptions }) => {
      capturedOptions = opts.options;
      return sessionIdQuery(PREMINTED);
    });
    const session = await resumeOrGetSession(PREMINTED, "alice@example.com", undefined, undefined, undefined, {
      adoptSessionId: PREMINTED,
    });
    session.send("what is the points doctrine");
    await new Promise((r) => setTimeout(r, 0));
    expect(recordThreadMock).toHaveBeenCalledWith(
      expect.anything(),
      PREMINTED,
      "alice@example.com",
      "title:what is the points doctrine",
    );
    session.dispose();
  });
});

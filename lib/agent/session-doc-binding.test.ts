// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Spec 2026-08-27: a doc-bound AgentSession forwards its binding into
// buildOptions (arg 11) and, at register time, records the doc_threads row
// and the `Copilot: <doc title>` thread title. Mock recipe mirrors
// ./session.test.ts (which must not be edited): the SDK query is faked and
// buildOptions is mocked to capture its arguments.

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

const recordThreadMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  recordThread: (...args: unknown[]) => recordThreadMock(...args),
  titleFrom: (text?: string) => (text ?? "New chat").slice(0, 80),
}));

const bindDocThreadMock = vi.fn();
vi.mock("@/lib/db/doc-threads", () => ({
  bindDocThread: (...args: unknown[]) => bindDocThreadMock(...args),
}));

const { AgentSession } = await import("./session");

const BINDING = { docId: "11111111-1111-1111-1111-111111111111", docTitle: "Pricing Plan", access: "comment" as const };

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  buildOptionsMock.mockClear();
  recordThreadMock.mockClear();
  bindDocThreadMock.mockClear();
  nextQuery = parkedQuery;
});

describe("AgentSession doc binding", () => {
  it("forwards the binding to buildOptions as the eleventh argument", () => {
    const session = new AgentSession("bob@example.com", undefined, undefined, BINDING);
    expect(buildOptionsMock.mock.calls[0][10]).toEqual(BINDING);
    session.dispose();
  });

  it("passes null through for an ordinary chat", () => {
    const session = new AgentSession("bob@example.com");
    expect(buildOptionsMock.mock.calls[0][10]).toBeNull();
    session.dispose();
  });

  it("records the binding and the Copilot title when the SDK id registers", async () => {
    nextQuery = () => queryWithSessionId("sdk-1");
    const session = new AgentSession("bob@example.com", undefined, undefined, BINDING);
    await flush();
    expect(recordThreadMock).toHaveBeenCalledWith({}, "sdk-1", "bob@example.com", "Copilot: Pricing Plan");
    expect(bindDocThreadMock).toHaveBeenCalledWith({}, "sdk-1", BINDING.docId, "bob@example.com");
    session.dispose();
  });

  it("does not rebind or retitle on a resumed session (register never fires)", async () => {
    nextQuery = () => queryWithSessionId("sdk-1");
    const session = new AgentSession("bob@example.com", "sdk-1", undefined, BINDING);
    await flush();
    expect(recordThreadMock).not.toHaveBeenCalled();
    expect(bindDocThreadMock).not.toHaveBeenCalled();
    session.dispose();
  });
});

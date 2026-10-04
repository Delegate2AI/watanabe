// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => ({
    [Symbol.asyncIterator]: async function* () {
      await new Promise<never>(() => {});
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  }),
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
vi.mock("@/lib/db/threads", () => ({
  recordThread: vi.fn(),
  getThreadModelChoice: () => null,
  titleFrom: (text?: string) => (text ?? "New chat").slice(0, 80),
}));

const projectContextMock = vi.fn();
vi.mock("@/lib/db/project-context", () => ({
  projectContextForThread: (...args: unknown[]) => projectContextMock(...args),
}));

const { AgentSession } = await import("./session");

const OWNER = "alice@example.com";
const RESUME_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_CONTEXT_ARG = 7;

beforeEach(() => {
  buildOptionsMock.mockClear();
  projectContextMock.mockReset().mockReturnValue("Write for the board.");
  process.env.PROJECTS_ENABLED = "1";
});

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
});

describe("AgentSession project context", () => {
  it("passes the resumed thread's project context to buildOptions", () => {
    const session = new AgentSession(OWNER, RESUME_ID);
    expect(buildOptionsMock.mock.calls[0][PROJECT_CONTEXT_ARG]).toBe("Write for the board.");
    expect(projectContextMock).toHaveBeenCalledWith(expect.anything(), RESUME_ID, OWNER, ["all-hands"]);
    session.dispose();
  });

  it("passes no context and reads nothing when projects are off", () => {
    delete process.env.PROJECTS_ENABLED;
    const session = new AgentSession(OWNER, RESUME_ID);
    expect(buildOptionsMock.mock.calls[0][PROJECT_CONTEXT_ARG]).toBeUndefined();
    expect(projectContextMock).not.toHaveBeenCalled();
    session.dispose();
  });

  it("passes no context for a fresh thread, which no project can hold yet", () => {
    const session = new AgentSession(OWNER);
    expect(buildOptionsMock.mock.calls[0][PROJECT_CONTEXT_ARG]).toBeUndefined();
    expect(projectContextMock).not.toHaveBeenCalled();
    session.dispose();
  });

  it("degrades to no context when the lookup throws", () => {
    projectContextMock.mockImplementation(() => {
      throw new Error("db locked");
    });
    const session = new AgentSession(OWNER, RESUME_ID);
    expect(buildOptionsMock.mock.calls[0][PROJECT_CONTEXT_ARG]).toBeUndefined();
    session.dispose();
  });
});

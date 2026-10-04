import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachmentDirFor } from "@/lib/attachments/store";

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

type PreToolUseFn = (input: unknown) => Promise<unknown>;
type CapturedOptions = {
  preToolUse?: PreToolUseFn;
  extras?: { adoptSessionId?: string; attachmentDir?: string };
};

let capturedOptions: CapturedOptions | undefined;
const queryMock = vi.fn((opts: { options: CapturedOptions }) => {
  capturedOptions = opts.options;
  return fakeQuery();
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { options: CapturedOptions }) => queryMock(opts),
  getSessionMessages: vi.fn(),
}));

vi.mock("@/lib/identity/resolve", () => ({ resolveClearanceForEmail: () => ["all-hands"] }));

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return { ...actual, vaultRootFor: () => "/projection/all-hands" };
});

const gateAgentToolSpy = vi.fn();
vi.mock("./permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./permissions")>();
  return {
    ...actual,
    gateAgentTool: (...args: Parameters<typeof actual.gateAgentTool>) => {
      gateAgentToolSpy(...args);
      return actual.gateAgentTool(...args);
    },
  };
});

vi.mock("./config", () => ({
  buildOptions: (
    preToolUse: unknown,
    canUseTool: unknown,
    writeContext: unknown,
    resume?: string,
    memoryContext?: string,
    clearanceSet?: string[],
    modelChoice?: unknown,
    projectContext?: string,
    connectorServers?: unknown,
    skillsPlugin?: unknown,
    docBinding?: unknown,
    extras?: { adoptSessionId?: string; attachmentDir?: string },
  ) => ({ preToolUse, extras }),
}));

vi.mock("@/lib/quality/gather", () => ({ gatherAdvisoryFindings: async () => [] }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/db/threads", () => ({
  recordThread: vi.fn(),
  getThreadModelChoice: () => null,
  titleFrom: (text?: string) => `title:${text ?? ""}`,
}));

const { AgentSession } = await import("./session");

const RESUME_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = "alice@example.com";

beforeEach(() => {
  queryMock.mockClear();
  gateAgentToolSpy.mockClear();
  capturedOptions = undefined;
  process.env.ATTACHMENTS_DIR = "/tmp/attach-test";
  process.env.AUTHORITY_ENABLED = "1";
});

afterEach(() => {
  delete process.env.ATTACHMENTS_ENABLED;
  delete process.env.ATTACHMENTS_DIR;
  delete process.env.AUTHORITY_ENABLED;
});

describe("AgentSession, attachment read root", () => {
  it("hands the gate the caller's own attachment directory for this thread", async () => {
    process.env.ATTACHMENTS_ENABLED = "1";
    const session = new AgentSession(OWNER, RESUME_ID);
    await capturedOptions?.preToolUse?.({
      tool_name: "Read",
      tool_input: { file_path: `${attachmentDirFor(OWNER, RESUME_ID)}/u-a.pdf` },
    });
    expect(gateAgentToolSpy).toHaveBeenLastCalledWith(
      "Read",
      expect.anything(),
      RESUME_ID,
      expect.anything(),
      OWNER,
      expect.anything(),
      expect.anything(),
      attachmentDirFor(OWNER, RESUME_ID),
    );
    session.dispose();
  });

  it("declares the attachment directory to the SDK on a resume", () => {
    process.env.ATTACHMENTS_ENABLED = "1";
    const session = new AgentSession(OWNER, RESUME_ID);
    expect(capturedOptions?.extras?.attachmentDir).toBe(attachmentDirFor(OWNER, RESUME_ID));
    session.dispose();
  });

  it("declares the attachment directory for an adopted id too", () => {
    process.env.ATTACHMENTS_ENABLED = "1";
    const session = new AgentSession(OWNER, undefined, undefined, null, undefined, undefined, null, RESUME_ID);
    expect(capturedOptions?.extras?.attachmentDir).toBe(attachmentDirFor(OWNER, RESUME_ID));
    session.dispose();
  });

  it("declares nothing when the flag is off, keeping the options byte-identical", () => {
    delete process.env.ATTACHMENTS_ENABLED;
    const session = new AgentSession(OWNER, RESUME_ID);
    expect(capturedOptions?.extras?.attachmentDir).toBeUndefined();
    session.dispose();
  });

  it("declares nothing for a session with no id at all", () => {
    process.env.ATTACHMENTS_ENABLED = "1";
    const session = new AgentSession(OWNER);
    expect(capturedOptions?.extras?.attachmentDir).toBeUndefined();
    session.dispose();
  });
});

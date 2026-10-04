import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Spec 34 task 8: the SESSION wiring proof. A real `AgentSession` is
 * constructed with the SDK's `query()` and `./config`'s `buildOptions` mocked
 * (same shape as session-owner-gate.test.ts), so the assertions are about what
 * the session actually hands to the SDK and to the permission gate:
 *
 *  - the materializer is called with the session's own resolved clearance, the
 *    same value connectors and the vault root already use;
 *  - the materialization itself (path plus slugs) reaches `buildOptions`;
 *  - its `slugs` reach `gateAgentTool` (the REAL one), so the Skill tool is
 *    allowed for a materialized slug and denied for anything else;
 *  - a null materialization leaves a working session with the Skill tool denied;
 *  - with the flag off the materializer is never called at all.
 */

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

type PreToolUseFn = (input: unknown) => Promise<{ hookSpecificOutput: { permissionDecision: string } }>;
type CapturedOptions = { preToolUse?: PreToolUseFn; canUseTool?: CanUseTool };

let capturedPreToolUse: PreToolUseFn | undefined;
let capturedArgs: unknown[] = [];

const queryMock = vi.fn((opts: { options: CapturedOptions }) => {
  capturedPreToolUse = opts.options.preToolUse;
  return fakeQuery();
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { options: CapturedOptions }) => queryMock(opts),
  getSessionMessages: vi.fn(),
}));

vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: () => ["all-hands", "finance"],
}));

vi.mock("./config", () => ({
  buildOptions: (...args: unknown[]) => {
    capturedArgs = args;
    return { preToolUse: args[0], canUseTool: args[1] };
  },
}));

const materializeMock = vi.fn();
vi.mock("@/lib/skills/materialize", () => ({
  materializeSkillsPlugin: (...args: unknown[]) => materializeMock(...args),
}));

vi.mock("@/lib/quality/gather", () => ({ gatherAdvisoryFindings: vi.fn(async () => []) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/db/threads", () => ({
  recordThread: vi.fn(),
  titleFrom: (text?: string) => `title:${text ?? ""}`,
}));

const { AgentSession } = await import("./session");

const PLUGIN_PATH = "/tmp/skills-materialized/0123456789abcdef";
const saved = { ...process.env };

/** Construct a session, run one PreToolUse decision through it, dispose. */
async function decide(toolName: string, toolInput: unknown): Promise<string> {
  const session = new AgentSession("owner@example.com");
  try {
    if (!capturedPreToolUse) throw new Error("preToolUse was never captured");
    const out = await capturedPreToolUse({
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
    });
    return out.hookSpecificOutput.permissionDecision;
  } finally {
    session.dispose();
  }
}

beforeEach(() => {
  queryMock.mockClear();
  materializeMock.mockReset();
  capturedPreToolUse = undefined;
  capturedArgs = [];
  process.env.SKILLS_ENABLED = "1";
  materializeMock.mockReturnValue({ pluginPath: PLUGIN_PATH, slugs: ["brand-guidelines", "deal-memo"] });
});

afterEach(() => {
  process.env = { ...saved };
});

describe("AgentSession wires the materialized skills plugin (spec 34)", () => {
  it("materializes for the session's own resolved clearance set", () => {
    new AgentSession("owner@example.com").dispose();
    expect(materializeMock).toHaveBeenCalledTimes(1);
    expect(materializeMock.mock.calls[0][0]).toEqual(["all-hands", "finance"]);
  });

  it("passes the whole materialization to buildOptions as the trailing argument", () => {
    // One value, so the plugin directory the SDK loads and the slugs it is
    // allowed to run can never come from different materializations.
    new AgentSession("owner@example.com").dispose();
    expect(capturedArgs[9]).toEqual({
      pluginPath: PLUGIN_PATH,
      slugs: ["brand-guidelines", "deal-memo"],
    });
  });

  it("passes undefined to buildOptions when materialization returns null", () => {
    materializeMock.mockReturnValue(null);
    new AgentSession("owner@example.com").dispose();
    expect(capturedArgs[9] ?? null).toBeNull();
  });

  it("never calls the materializer when the flag is off", () => {
    delete process.env.SKILLS_ENABLED;
    new AgentSession("owner@example.com").dispose();
    expect(materializeMock).not.toHaveBeenCalled();
    expect(capturedArgs[9] ?? null).toBeNull();
  });
});

describe("AgentSession gates the Skill tool on the materialized slugs (spec 34)", () => {
  it("allows a slug the materialization resolved for this caller", async () => {
    expect(await decide("Skill", { skill: "brand-guidelines" })).toBe("allow");
  });

  it("denies a slug outside the resolved set", async () => {
    expect(await decide("Skill", { skill: "board-minutes" })).toBe("deny");
  });

  it("denies every Skill call when materialization returned null, and the session still works", async () => {
    materializeMock.mockReturnValue(null);
    expect(await decide("Skill", { skill: "brand-guidelines" })).toBe("deny");
    // The rest of the session is untouched: an ordinary tool still decides normally.
    expect(await decide("TodoWrite", { todos: [] })).toBe("allow");
  });

  it("denies every Skill call when the flag is off", async () => {
    delete process.env.SKILLS_ENABLED;
    expect(await decide("Skill", { skill: "brand-guidelines" })).toBe("deny");
  });

  it("denies a skill that a different clearance would have (the gate re-checks the set)", async () => {
    // The materialized directory for THIS caller holds only these two slugs;
    // the gate refuses anything else regardless of what is on disk elsewhere.
    materializeMock.mockReturnValue({ pluginPath: PLUGIN_PATH, slugs: ["deal-memo"] });
    expect(await decide("Skill", { skill: "brand-guidelines" })).toBe("deny");
    expect(await decide("Skill", { skill: "deal-memo" })).toBe("allow");
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Spec 22 runtime wiring (#23): the SECURITY proof that `AgentSession`'s
 * PreToolUse hook threads the thread OWNER's email into `gateAgentTool`, so the
 * role-aware write gate (`lib/authority/write-gate.ts`) is actually enforced at
 * runtime, not inert.
 *
 * The discriminating case is the editor: with `ownerEmail` threaded, an editor
 * owner's `kb_submit` returns "ask" (confirm) while a viewer's returns "deny".
 * Under the pre-fix bug (`ownerEmail` omitted, so the gate saw ""), the empty
 * identity resolved to the default `viewer` role and BOTH would have been
 * denied. So the editor -> "ask" outcome can only happen if the real owner
 * reached the gate.
 *
 * A real `AgentSession` is constructed, so the SDK's `query()` and `./config`'s
 * `buildOptions()` are mocked exactly as in `session.test.ts`: `query()` parks
 * forever (an idle warm session) and we capture the `preToolUse` callback the
 * session wired in, then invoke it the way the SDK would. `gateAgentTool` and
 * the authority modules are the REAL ones: the assertion is the wiring.
 */

type FakeQuery = AsyncIterable<never> & {
  interrupt: () => Promise<void>;
  getContextUsage: () => Promise<{ totalTokens: number; maxTokens: number; percentage: number }>;
};

function fakeQuery(): FakeQuery {
  return {
    [Symbol.asyncIterator]: async function* () {
      await new Promise<never>(() => {}); // never resolves (mirrors an idle warm session)
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0, percentage: 0 }),
  };
}

type PreToolUseFn = (input: unknown) => Promise<{ hookSpecificOutput: { permissionDecision: string } }>;
type CapturedOptions = { preToolUse?: PreToolUseFn; canUseTool?: CanUseTool };

let capturedPreToolUse: PreToolUseFn | undefined;
const queryMock = vi.fn((opts: { options: CapturedOptions }) => {
  capturedPreToolUse = opts.options.preToolUse;
  return fakeQuery();
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { options: CapturedOptions }) => queryMock(opts),
  getSessionMessages: vi.fn(),
}));

vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: () => ["all-hands"],
}));

vi.mock("./config", () => ({
  buildOptions: (preToolUse: unknown, canUseTool: unknown) => ({ preToolUse, canUseTool }),
}));

vi.mock("@/lib/quality/gather", () => ({ gatherAdvisoryFindings: vi.fn(async () => []) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/db/threads", () => ({
  recordThread: vi.fn(),
  titleFrom: (text?: string) => `title:${text ?? ""}`,
}));

const { AgentSession } = await import("./session");

const SUBMIT_TOOL = "mcp__kb__kb_submit";
const savedEnv = { ...process.env };
let memoryRoot: string;

/** Drive the captured PreToolUse hook the way the SDK would, returning its decision. */
async function decide(owner: string, tool = SUBMIT_TOOL): Promise<string> {
  const session = new AgentSession(owner);
  try {
    if (!capturedPreToolUse) throw new Error("preToolUse was never captured");
    const out = await capturedPreToolUse({
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { message: "propose an edit", slug: "edit" },
    });
    return out.hookSpecificOutput.permissionDecision;
  } finally {
    session.dispose();
  }
}

beforeEach(() => {
  queryMock.mockClear();
  capturedPreToolUse = undefined;
  memoryRoot = mkdtempSync(path.join(os.tmpdir(), "session-owner-gate-"));
  mkdirSync(path.join(memoryRoot, "access"), { recursive: true });
  writeFileSync(
    path.join(memoryRoot, "access", "roles.yaml"),
    "roles:\n  editor: [editor@example.com]\ndefault: viewer\n",
  );
  process.env.MEMORY_CHECKOUT_DIR = memoryRoot;
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(memoryRoot, { recursive: true, force: true });
});

describe("AgentSession preToolUse threads ownerEmail into the write gate (spec 22 #23)", () => {
  it("denies a write for a viewer owner, but confirm-gates it for an editor owner (proves owner reached the gate)", async () => {
    // The editor -> "ask" is only reachable if this.ownerEmail was threaded:
    // an omitted owner ("") resolves to the default viewer and would deny both.
    expect(await decide("viewer@example.com")).toBe("deny");
    expect(await decide("editor@example.com")).toBe("ask");
  });

  it("fails closed: an unknown owner (not in roles.yaml) is denied", async () => {
    expect(await decide("stranger@example.com")).toBe("deny");
  });

  it("fails closed: an empty owner is denied when roles are on", async () => {
    expect(await decide("")).toBe("deny");
  });

  it("is byte-identical to today when ROLES_ENABLED is off: even a viewer owner confirm-gates the write", async () => {
    process.env.ROLES_ENABLED = "0";
    // With roles off the gate reduces to the KB_WRITE_ENABLED master switch, so
    // the owner's role is irrelevant and kb_submit confirm-gates as it always has.
    expect(await decide("viewer@example.com")).toBe("ask");
  });

  it("still honors the master kill switch: KB_WRITE_ENABLED off denies even an editor owner", async () => {
    process.env.KB_WRITE_ENABLED = "0";
    expect(await decide("editor@example.com")).toBe("deny");
  });
});

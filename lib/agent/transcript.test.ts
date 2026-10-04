import { describe, it, expect, vi } from "vitest";
import { renderContextBlock, type ResolvedContext } from "./context-resolve";

const getSessionMessagesMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: (...args: unknown[]) => getSessionMessagesMock(...args),
}));

vi.mock("@/lib/repo", () => ({ vaultRoot: () => "/fake/vault" }));

const { loadTranscript } = await import("./transcript");

function userMessage(uuid: string, content: string) {
  return { type: "user" as const, uuid, session_id: "s1", message: { content }, parent_tool_use_id: null };
}

const resolved: ResolvedContext = {
  path: "04-economy/tokenomics.md",
  headingTrail: ["Economy", "Tokenomics"],
  startLine: 7,
  endLine: 7,
  excerpt: "Points are the user-facing unit of value in Meridian.",
  enclosingSection: "## Tokenomics\n\nPoints are the user-facing unit of value in Meridian.",
  truncated: false,
  provenance: "verified",
  docTitle: "Tokenomics",
};

describe("loadTranscript — spec 11 context-block splitting on resume", () => {
  it("splits a stored <portal-context> block back into chips + the remainder", async () => {
    const block = renderContextBlock([resolved]);
    getSessionMessagesMock.mockResolvedValue([userMessage("u1", `${block}\n\nWhat does this mean?`)]);

    const turns = await loadTranscript("s1");

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ role: "user", content: "What does this mean?" });
    expect((turns[0] as { context?: unknown }).context).toEqual([
      {
        path: "04-economy/tokenomics.md",
        headingTrail: ["Economy", "Tokenomics"],
        startLine: 7,
        endLine: 7,
        provenance: "verified",
        truncated: false,
      },
    ]);
  });

  it("behaves exactly as before (no context field) when no block is present", async () => {
    getSessionMessagesMock.mockResolvedValue([userMessage("u1", "What is Orbit?")]);

    const turns = await loadTranscript("s1");

    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({ id: "u1", role: "user", content: "What is Orbit?" });
    expect((turns[0] as { context?: unknown }).context).toBeUndefined();
  });
});

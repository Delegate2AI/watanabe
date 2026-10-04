import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `gatherAdvisoryFindings` is exercised WITHOUT a live SDK or real git: the
 * repo-write diff function and the judgment-agent runner (`reviewStagedDiff`)
 * are both mocked, so these tests cover this module's own wiring (the
 * enabled/disabled gate, combining the mechanical re-scan with the mocked
 * agent findings, and never-throws-on-diff-failure), not `lib/repo-write.ts`
 * or `lib/quality/agents.ts` themselves (each already has its own suite).
 */

const diffMock = vi.fn(async (): Promise<string> => "");
vi.mock("@/lib/repo-write", () => ({
  diff: (...args: [string]) => diffMock(...args),
}));

const reviewStagedDiffMock = vi.fn(async () => [] as { agent: string; severity: string; message: string }[]);
vi.mock("./agents", () => ({
  reviewStagedDiff: (...args: [string, string?]) => reviewStagedDiffMock(...args),
}));

const { gatherAdvisoryFindings } = await import("./gather");

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  diffMock.mockReset();
  reviewStagedDiffMock.mockReset();
});

// research-harness's check-em-dash.py bans U+2014 (em dash); built from a
// code point, not a literal character, so this test file stays free of the
// banned glyph itself (same convention as lib/quality/mechanical.test.ts).
const EM_DASH = String.fromCodePoint(0x2014);

describe("gatherAdvisoryFindings", () => {
  it("resolves to [] when quality gates are disabled, without ever fetching a diff", async () => {
    delete process.env.QUALITY_GATES_ENABLED;
    await expect(gatherAdvisoryFindings("thread-1")).resolves.toEqual([]);
    expect(diffMock).not.toHaveBeenCalled();
    expect(reviewStagedDiffMock).not.toHaveBeenCalled();
  });

  it("combines the mechanical re-scan and the agent findings when enabled", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    diffMock.mockResolvedValue(
      [
        "diff --git a/note.md b/note.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/note.md",
        "@@ -0,0 +1,2 @@",
        `+Growth accelerated ${EM_DASH} fast.`,
        "+A clean second line.",
      ].join("\n"),
    );
    reviewStagedDiffMock.mockResolvedValue([{ agent: "citation-checker", severity: "warn", message: "unsourced figure" }]);

    const findings = await gatherAdvisoryFindings("thread-1");

    expect(diffMock).toHaveBeenCalledWith("thread-1");
    expect(reviewStagedDiffMock).toHaveBeenCalledTimes(1);

    expect(findings).toContainEqual({ agent: "citation-checker", severity: "warn", message: "unsourced figure" });

    const mechanical = findings.find((f) => f.agent === "deliverable-check");
    expect(mechanical).toBeDefined();
    expect(mechanical?.severity).toBe("warn");
    expect(mechanical?.message).toMatch(/em-dash/);
  });

  it("resolves to [] (never throws) when fetching the diff fails", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    diffMock.mockRejectedValue(new Error("git blew up"));
    await expect(gatherAdvisoryFindings("thread-1")).resolves.toEqual([]);
    expect(reviewStagedDiffMock).not.toHaveBeenCalled();
  });

  it("resolves to [] for an empty staged diff, without invoking the agents", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    diffMock.mockResolvedValue("   \n\t  ");
    await expect(gatherAdvisoryFindings("thread-1")).resolves.toEqual([]);
    expect(reviewStagedDiffMock).not.toHaveBeenCalled();
  });

  it("forwards scopeRoot through to reviewStagedDiff", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    diffMock.mockResolvedValue("+some added content");
    reviewStagedDiffMock.mockResolvedValue([]);

    await gatherAdvisoryFindings("thread-1", "/scoped/root");

    expect(reviewStagedDiffMock).toHaveBeenCalledWith("+some added content", "/scoped/root", "thread-1");
  });
});

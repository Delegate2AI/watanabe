import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * `kb_check`, the pre-submit integrity check. Its own file because it needs
 * module-level mocks for `@/lib/quality/config` and `@/lib/quality/agents`,
 * the same reason `write-tools.integrity.test.ts` and
 * `write-tools.quality.test.ts` are split out.
 */

const diffMock = vi.fn(async () => "");
vi.mock("@/lib/repo-write", () => ({
  diff: (...args: unknown[]) => diffMock(...args),
}));

const isIntegrityEnabledMock = vi.fn(() => true);
vi.mock("@/lib/quality/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quality/config")>();
  return { ...actual, isIntegrityEnabled: () => isIntegrityEnabledMock() };
});

const runIntegrityCheckerMock = vi.fn(async () => [] as { agent: string; severity: string; message: string }[]);
vi.mock("@/lib/quality/agents", () => ({
  runIntegrityChecker: (...args: [string, string?]) => runIntegrityCheckerMock(...args),
}));

const { createCheckTool, formatFindings, integrityFindingsFor } = await import("./check-tool");
import type { KbWriteContext } from "./write-tools";

const context: KbWriteContext = { getThreadId: () => "thread-1", ownerEmail: "alice@example.com" };

function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

async function run(toolContext: KbWriteContext = context): Promise<CallToolResult> {
  return createCheckTool(toolContext).handler({}, {});
}

beforeEach(() => {
  diffMock.mockReset();
  diffMock.mockResolvedValue("");
  isIntegrityEnabledMock.mockReset();
  isIntegrityEnabledMock.mockReturnValue(true);
  runIntegrityCheckerMock.mockReset();
  runIntegrityCheckerMock.mockResolvedValue([]);
});

describe("kb_check", () => {
  it("says nothing is staged, and never runs the checker, on an empty diff", async () => {
    const result = await run();

    expect(text(result)).toContain("nothing staged yet");
    expect(runIntegrityCheckerMock).not.toHaveBeenCalled();
  });

  it("reports the check as unavailable when the flag is off", async () => {
    diffMock.mockResolvedValue("diff --git a/docs/a.md b/docs/a.md\n+new line\n");
    isIntegrityEnabledMock.mockReturnValue(false);

    const result = await run();

    expect(text(result)).toContain("not enabled");
    expect(runIntegrityCheckerMock).not.toHaveBeenCalled();
  });

  it("reports a clean result when the checker finds nothing", async () => {
    diffMock.mockResolvedValue("diff --git a/docs/a.md b/docs/a.md\n+new line\n");

    const result = await run();

    expect(result.isError).not.toBe(true);
    expect(text(result)).toContain("No duplicate or contradicting");
  });

  it("returns every finding's own message, so the contributor learns what conflicts", async () => {
    diffMock.mockResolvedValue("diff --git a/docs/a.md b/docs/a.md\n+Fees are 20 bps.\n");
    runIntegrityCheckerMock.mockResolvedValue([
      { agent: "integrity-checker", severity: "warn", message: "Contradicts docs/04-economy/fees.md, which says 30 bps." },
      { agent: "integrity-checker", severity: "info", message: "Overlaps docs/04-economy/overview.md." },
    ]);

    const result = await run();

    expect(text(result)).toContain("Contradicts docs/04-economy/fees.md, which says 30 bps.");
    expect(text(result)).toContain("Overlaps docs/04-economy/overview.md.");
    expect(text(result)).toContain("warn");
  });

  it("passes the caller's clearance scope through to the checker", async () => {
    diffMock.mockResolvedValue("diff --git a/docs/a.md b/docs/a.md\n+x\n");

    await run({ ...context, scopeRoot: "/projection/admins" });

    expect(runIntegrityCheckerMock).toHaveBeenCalledWith(expect.any(String), "/projection/admins");
  });

  it("does not fail the tool call when the checker itself degrades to no findings", async () => {
    diffMock.mockResolvedValue("diff --git a/docs/a.md b/docs/a.md\n+x\n");
    runIntegrityCheckerMock.mockResolvedValue([]);

    const result = await run();

    expect(result.isError).not.toBe(true);
  });
});

describe("integrityFindingsFor", () => {
  it("returns nothing and never calls the checker when the flag is off", async () => {
    isIntegrityEnabledMock.mockReturnValue(false);

    expect(await integrityFindingsFor("some diff")).toEqual([]);
    expect(runIntegrityCheckerMock).not.toHaveBeenCalled();
  });

  it("runs the checker on the diff it is given, whatever that diff is", async () => {
    await integrityFindingsFor("some diff", "/scope");

    expect(runIntegrityCheckerMock).toHaveBeenCalledWith("some diff", "/scope");
  });
});

describe("formatFindings", () => {
  it("puts one finding per line, severity first", () => {
    const out = formatFindings([
      { agent: "integrity-checker", severity: "warn", message: "A." },
      { agent: "integrity-checker", severity: "info", message: "B." },
    ]);

    expect(out).toBe("- [warn] A.\n- [info] B.");
  });
});

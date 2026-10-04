import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

type QueryOpts = { prompt: string; options: Options };
type FakeAgent = (opts: QueryOpts) => AsyncGenerator<unknown>;

let fakeAgent: FakeAgent = async function* () {};
const queryMock = vi.fn((opts: QueryOpts) => fakeAgent(opts));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return { ...actual, query: (opts: QueryOpts) => queryMock(opts) };
});

let createKbReadOnlyMcpServerMock: (scopeRoot?: string) => unknown = (scopeRoot) =>
  actualCreateKbReadOnlyMcpServer(scopeRoot);

vi.mock("@/lib/kb-mcp/read-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kb-mcp/read-tools")>();
  return {
    ...actual,
    createKbReadOnlyMcpServer: (scopeRoot?: string) => createKbReadOnlyMcpServerMock(scopeRoot),
  };
});

const { createKbReadOnlyMcpServer: actualCreateKbReadOnlyMcpServer } = await vi.importActual<
  typeof import("@/lib/kb-mcp/read-tools")
>("@/lib/kb-mcp/read-tools");

const {
  citationCheckerPrompt,
  integrityCheckerPrompt,
  parseFindings,
  reviewStagedDiff,
  runIntegrityChecker,
  styleReviewerPrompt,
} = await import("./agents");

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  queryMock.mockClear();
  fakeAgent = async function* () {};
  createKbReadOnlyMcpServerMock = (scopeRoot) => actualCreateKbReadOnlyMcpServer(scopeRoot);
});

describe("citationCheckerPrompt", () => {
  it("names its job (sourcing figures/claims) and demands JSON-only output", () => {
    const p = citationCheckerPrompt();
    expect(p).toMatch(/citation/i);
    expect(p).toMatch(/source/i);
    expect(p).toMatch(/figure/i);
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/severity/);
    expect(p).toMatch(/"warn"/);
    expect(p).toMatch(/"info"/);
  });
});

describe("styleReviewerPrompt", () => {
  it("names the structural issues it looks for and demands JSON-only output", () => {
    const p = styleReviewerPrompt();
    expect(p).toMatch(/superlative/i);
    expect(p).toMatch(/attribution/i);
    expect(p).toMatch(/scaffolding|filler/i);
    expect(p).toMatch(/promotional/i);
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/severity/);
  });
});

describe("integrityCheckerPrompt", () => {
  it("names its job (search/read tools, duplicate/contradiction) and demands JSON-only output", () => {
    const p = integrityCheckerPrompt();
    expect(p).toMatch(/kb_search/);
    expect(p).toMatch(/kb_read/);
    expect(p).toMatch(/duplicate/i);
    expect(p).toMatch(/contradiction/i);
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/"warn"/);
    expect(p).toMatch(/"info"/);
  });
});

describe("parseFindings", () => {
  it("parses valid JSON lines into findings tagged with the given agent", () => {
    const text = ['{"severity":"warn","message":"unsourced figure"}', '{"severity":"info","message":"soft note"}'].join(
      "\n",
    );
    expect(parseFindings(text, "citation-checker")).toEqual([
      { agent: "citation-checker", severity: "warn", message: "unsourced figure" },
      { agent: "citation-checker", severity: "info", message: "soft note" },
    ]);
  });

  it("skips garbage and prose lines without throwing", () => {
    const text = [
      "Sure, here are the findings:",
      '{"severity":"warn","message":"ok"}',
      "not json at all {{{",
      '{"severity":"maybe","message":"bad severity"}',
      '{"message":"missing severity"}',
      '{"severity":"warn"}',
      "",
    ].join("\n");
    expect(parseFindings(text, "style-reviewer")).toEqual([
      { agent: "style-reviewer", severity: "warn", message: "ok" },
    ]);
  });

  it("returns [] for empty or fully non-JSON text", () => {
    expect(parseFindings("", "citation-checker")).toEqual([]);
    expect(parseFindings("no findings here, just prose", "style-reviewer")).toEqual([]);
  });

  it("parses a top-level JSON array of findings, not just newline-delimited objects", () => {
    const text = JSON.stringify([
      { severity: "warn", message: "first" },
      { severity: "info", message: "second" },
    ]);
    const findings = parseFindings(text, "style-reviewer");
    expect(findings).toEqual([
      { agent: "style-reviewer", severity: "warn", message: "first" },
      { agent: "style-reviewer", severity: "info", message: "second" },
    ]);
  });
});

describe("reviewStagedDiff", () => {
  it("resolves to [] for an empty or whitespace-only diff without invoking a query", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    await expect(reviewStagedDiff("")).resolves.toEqual([]);
    await expect(reviewStagedDiff("   \n\t  ")).resolves.toEqual([]);
  });

  it("resolves to [] when quality gates are disabled, even with a real diff", async () => {
    delete process.env.QUALITY_GATES_ENABLED;
    await expect(reviewStagedDiff("+some added content")).resolves.toEqual([]);
  });

  it("also runs integrity-checker when INTEGRITY_ENABLED is on, scoped to the three read-only kb tools", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    process.env.INTEGRITY_ENABLED = "1";
    fakeAgent = async function* () {
      yield { type: "result", subtype: "success", result: "" };
    };
    await reviewStagedDiff("+some added content");
    expect(queryMock).toHaveBeenCalledTimes(3);
    const integrityCall = queryMock.mock.calls.find((c) => (c[0].options.allowedTools?.length ?? 0) > 0);
    expect(integrityCall).toBeDefined();
    expect(integrityCall![0].options.allowedTools).toEqual([
      "mcp__kb__kb_search",
      "mcp__kb__kb_read",
      "mcp__kb__kb_list",
    ]);
    expect(integrityCall![0].options.mcpServers).toHaveProperty("kb");
    expect(integrityCall![0].options.maxTurns).toBe(8);
  });

  it("removes the built-in tools rather than only declining to auto-approve them", () => {
    // `allowedTools` alone left the whole claude_code preset available, Bash
    // included, auto-approved by bypassPermissions. The input to these agents is
    // a staged KB diff, so its text is not ours to trust. `tools` is the lever
    // that decides what exists; both lists have to agree.
    process.env.QUALITY_GATES_ENABLED = "1";
    process.env.INTEGRITY_ENABLED = "1";
    fakeAgent = async function* () {
      yield { type: "result", subtype: "success", result: "" };
    };
    return reviewStagedDiff("+some added content").then(() => {
      for (const call of queryMock.mock.calls) {
        expect(call[0].options.tools).toEqual(call[0].options.allowedTools);
      }
    });
  });

  it("does not run integrity-checker when INTEGRITY_ENABLED is off, even with quality gates on", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    delete process.env.INTEGRITY_ENABLED;
    fakeAgent = async function* () {
      yield { type: "result", subtype: "success", result: "" };
    };
    await reviewStagedDiff("+some added content");
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

describe("runIntegrityChecker", () => {
  it("parses findings from the query result", async () => {
    fakeAgent = async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: '{"severity":"warn","message":"Duplicates docs/a.md: same claim already documented."}',
      };
    };
    const findings = await runIntegrityChecker("+added content", "/scoped/root");
    expect(findings).toEqual([
      { agent: "integrity-checker", severity: "warn", message: "Duplicates docs/a.md: same claim already documented." },
    ]);
  });

  it("resolves to [] (never throws) when the query fails", async () => {
    fakeAgent = async function* () {
      throw new Error("SDK exploded");
    };
    await expect(runIntegrityChecker("+diff", undefined)).resolves.toEqual([]);
  });

  it("resolves to [] (never throws) when createKbReadOnlyMcpServer throws synchronously", async () => {
    createKbReadOnlyMcpServerMock = () => {
      throw new Error("mcp server construction exploded");
    };
    await expect(runIntegrityChecker("+diff", undefined)).resolves.toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));
vi.mock("@/lib/agent/auth", () => ({ resolveAgentEnv: () => ({}) }));

import { DESIGN_CONSTRAINTS } from "@/lib/agent/design-prompt";
import { extractDocument, previewDesignGuide, SAMPLE_BRIEF } from "./preview";

/**
 * "Try it" runs the CANDIDATE guide, not the stored one. That is the whole
 * feature: an admin edits the box and sees the result before committing it, so
 * these assert that the unsaved text reaches the model and that a failure comes
 * back as a refusal a panel can show rather than as an exception.
 */

/** A query() stand-in: an async-iterable carrying one SDK result message. */
function sdkResult(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", subtype: "success", result: text };
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
}

const PAGE = "<!doctype html><html><head><title>T</title></head><body><h1>T</h1></body></html>";

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SAMPLE_BRIEF", () => {
  it("carries its own figures, because the guidance forbids inventing them", () => {
    expect(SAMPLE_BRIEF).toMatch(/11\.8/);
    expect(SAMPLE_BRIEF).toMatch(/chart/i);
  });

  it("says on its face that it is a sample", () => {
    expect(SAMPLE_BRIEF).toMatch(/sample/i);
  });
});

describe("extractDocument", () => {
  it("keeps a clean document unchanged", () => {
    expect(extractDocument(PAGE)).toBe(PAGE);
  });

  it("drops a preamble the model added before the doctype", () => {
    expect(extractDocument(`Here you go:\n\n${PAGE}`)).toBe(PAGE);
  });

  it("drops a markdown fence", () => {
    expect(extractDocument("```html\n" + PAGE + "\n```")).toBe(PAGE);
  });

  it("keeps a fragment that never declared a doctype, rather than returning nothing", () => {
    expect(extractDocument("<h1>T</h1>")).toBe("<h1>T</h1>");
  });
});

describe("previewDesignGuide", () => {
  it("sends the candidate guide, not the stored one", async () => {
    queryMock.mockReturnValue(sdkResult(PAGE));
    await previewDesignGuide("HOUSE STYLE\n\nEverything in one column.");
    const append = queryMock.mock.calls[0][0].options.systemPrompt.append;
    expect(append).toContain("Everything in one column.");
    expect(append).toContain(DESIGN_CONSTRAINTS);
  });

  it("asks for the document alone, so the reply is renderable", async () => {
    queryMock.mockReturnValue(sdkResult(PAGE));
    await previewDesignGuide("HOUSE STYLE\n\nWide margins.");
    expect(queryMock.mock.calls[0][0].options.systemPrompt.append).toMatch(/<!doctype html>/);
    expect(queryMock.mock.calls[0][0].prompt).toBe(SAMPLE_BRIEF);
  });

  it("removes the tools rather than only declining to auto-approve them", async () => {
    // `allowedTools` and `tools` are not the same lever. `allowedTools: []` only
    // auto-approves nothing; with `bypassPermissions` and no `tools`, the whole
    // claude_code preset (Bash, Read, Write, Edit) stays available and runs
    // unprompted. The prompt here is admin-authored text out of a web form, so
    // that shape turns an editor box into command execution.
    queryMock.mockReturnValue(sdkResult(PAGE));
    await previewDesignGuide("HOUSE STYLE\n\nWide margins.");
    const options = queryMock.mock.calls[0][0].options;
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual([]);
    expect(options.mcpServers).toBeUndefined();
  });

  it("runs one turn on a bounded budget, since it is a button an admin can hold down", async () => {
    queryMock.mockReturnValue(sdkResult(PAGE));
    await previewDesignGuide("HOUSE STYLE\n\nWide margins.");
    const options = queryMock.mock.calls[0][0].options;
    expect(options.maxTurns).toBe(1);
    expect(options.maxBudgetUsd).toBeGreaterThan(0);
  });

  it("refuses once too many previews are already running", async () => {
    // Per-call cost ceilings bound the price of one run, not the number of them.
    // The button's disabled state is client-side and protects nothing.
    const release: Array<() => void> = [];
    queryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => release.push(resolve));
        yield { type: "result", subtype: "success", result: PAGE };
      },
      interrupt: vi.fn().mockResolvedValue(undefined),
    }));

    const running = [previewDesignGuide("HOUSE A"), previewDesignGuide("HOUSE B")];
    await expect(previewDesignGuide("HOUSE C")).resolves.toEqual({ ok: false, error: "busy" });
    release.forEach((resolve) => resolve());
    await Promise.all(running);

    // And the slots come back, so a refusal is not permanent.
    queryMock.mockReturnValue(sdkResult(PAGE));
    await expect(previewDesignGuide("HOUSE D")).resolves.toEqual({ ok: true, html: PAGE });
  });

  it("returns the document", async () => {
    queryMock.mockReturnValue(sdkResult(`Sure thing.\n\n${PAGE}`));
    await expect(previewDesignGuide("HOUSE")).resolves.toEqual({ ok: true, html: PAGE });
  });

  it("refuses rather than throwing when the query fails", async () => {
    queryMock.mockImplementation(() => {
      throw new Error("no credentials");
    });
    await expect(previewDesignGuide("HOUSE")).resolves.toEqual({ ok: false, error: "failed" });
  });

  it("refuses rather than returning a blank frame when the model said nothing", async () => {
    queryMock.mockReturnValue(sdkResult(""));
    await expect(previewDesignGuide("HOUSE")).resolves.toEqual({ ok: false, error: "empty" });
  });
});

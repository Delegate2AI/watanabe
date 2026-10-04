import { describe, expect, it } from "vitest";
import { formatTokens, usedPercent } from "./format";
import { exampleModel, harnessSnippets, KEY_PLACEHOLDER } from "./harness-snippets";

describe("formatTokens", () => {
  it.each([
    [950, "950"],
    [12_000, "12k"],
    [1_500_000, "1.5M"],
    [250_000_000, "250M"],
    [2_000_000_000, "2B"],
  ])("%d -> %s", (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });
});

describe("usedPercent", () => {
  it("clamps, treats unlimited as empty and a zero limit as full", () => {
    expect(usedPercent(50, 200)).toBe(25);
    expect(usedPercent(500, 200)).toBe(100);
    expect(usedPercent(10, null)).toBe(0);
    expect(usedPercent(0, 0)).toBe(100);
  });
});

describe("harness snippets", () => {
  const snippets = harnessSnippets("https://llm.example.org/", "anthropic/claude-sonnet-4-5");

  it("covers the five harnesses the spec names", () => {
    expect(snippets.map((s) => s.id)).toEqual(["claude-code", "cursor", "cline", "codex", "continue"]);
  });

  it("gives Claude Code the origin and the others the /v1 base, never a real key", () => {
    expect(snippets[0].code).toContain('ANTHROPIC_BASE_URL="https://llm.example.org"');
    expect(snippets[1].code).toContain("https://llm.example.org/v1");
    for (const s of snippets) {
      const keyRef = s.id === "codex" ? "WATANABE_LLM_KEY" : KEY_PLACEHOLDER;
      expect(s.code).toContain(keyRef);
    }
  });

  it("picks a concrete model from the patterns when there is one", () => {
    expect(exampleModel(["anthropic/*", "ollama/qwen3:32b"])).toBe("ollama/qwen3:32b");
    expect(exampleModel(["*"])).toBe("<model id>");
  });
});

import { describe, expect, it } from "vitest";
import { matchReport } from "./preview";

describe("matchReport", () => {
  it("lists every matching group per model, in slug order, and none for unmatched", () => {
    const groups = [
      { slug: "paid", models: ["anthropic/*"] },
      { slug: "opus", models: ["anthropic/claude-opus-*"] },
      { slug: "local", models: ["ollama/*"] },
    ];
    expect(matchReport(groups, ["ollama/qwen3", "anthropic/claude-opus-5", "mistral/large", "ollama/qwen3"])).toEqual([
      { model: "anthropic/claude-opus-5", slugs: ["opus", "paid"] },
      { model: "mistral/large", slugs: [] },
      { model: "ollama/qwen3", slugs: ["local"] },
    ]);
  });
});

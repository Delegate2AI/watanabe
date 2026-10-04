import { describe, expect, it } from "vitest";
import { groupForModel, modelMatches } from "./match";

describe("modelMatches", () => {
  it("matches exactly without a star", () => {
    expect(modelMatches("anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4-5")).toBe(true);
    expect(modelMatches("anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4-5-x")).toBe(false);
  });

  it("treats star as any run of characters", () => {
    expect(modelMatches("anthropic/claude-opus-*", "anthropic/claude-opus-5-5")).toBe(true);
    expect(modelMatches("*", "ollama/qwen3:32b")).toBe(true);
  });

  it("treats regex metacharacters literally", () => {
    expect(modelMatches("openai/gpt-4.1", "openai/gpt-4x1")).toBe(false);
    expect(modelMatches("meta-llama/llama-3+", "meta-llama/llama-3+")).toBe(true);
    expect(modelMatches("meta-llama/llama-3+", "meta-llama/llama-33")).toBe(false);
  });

  it("never matches an empty pattern", () => {
    expect(modelMatches("  ", "")).toBe(false);
  });
});

describe("groupForModel", () => {
  const groups = [
    { slug: "paid", models: ["anthropic/*"] },
    { slug: "opus", models: ["anthropic/claude-opus-*"] },
  ];

  it("picks the first group by slug when two match", () => {
    expect(groupForModel(groups, "anthropic/claude-opus-5-5")?.slug).toBe("opus");
  });

  it("returns null for a model in no group", () => {
    expect(groupForModel(groups, "ollama/qwen3")).toBeNull();
  });
});

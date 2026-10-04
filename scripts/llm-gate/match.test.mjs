import { describe, expect, it } from "vitest";
import * as portal from "@/lib/llm/match";
import * as gate from "./match.mjs";

const CASES = [
  ["anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"],
  ["anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4-5-x"],
  ["anthropic/claude-opus-*", "anthropic/claude-opus-5-5"],
  ["*", "ollama/qwen3:32b"],
  ["openai/gpt-4.1", "openai/gpt-4x1"],
  ["meta-llama/llama-3+", "meta-llama/llama-3+"],
  ["meta-llama/llama-3+", "meta-llama/llama-33"],
  ["  ", ""],
  ["a*b*c", "aXXbYYc"],
];

describe("gate matching agrees with the portal", () => {
  it.each(CASES)("modelMatches(%j, %j)", (pattern, model) => {
    expect(gate.modelMatches(pattern, model)).toBe(portal.modelMatches(pattern, model));
  });

  it("picks the same group", () => {
    const groups = [
      { slug: "paid", models: ["anthropic/*"] },
      { slug: "opus", models: ["anthropic/claude-opus-*"] },
    ];
    for (const model of ["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-4-5", "ollama/qwen3"]) {
      expect(gate.groupForModel(groups, model)?.slug).toBe(portal.groupForModel(groups, model)?.slug);
    }
  });
});

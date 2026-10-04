import { describe, it, expect } from "vitest";
import { slugifyTitle, suggestTargetPath } from "./suggest-path";

describe("slugifyTitle", () => {
  it("lowercases and kebab-cases, collapsing punctuation and spaces", () => {
    expect(slugifyTitle("Liquidity Model Summary")).toBe("liquidity-model-summary");
    expect(slugifyTitle("  Q3: Rebalance (draft)!  ")).toBe("q3-rebalance-draft");
    expect(slugifyTitle("already-kebab")).toBe("already-kebab");
  });

  it("falls back to 'untitled' when nothing survives", () => {
    expect(slugifyTitle("")).toBe("untitled");
    expect(slugifyTitle("!!!")).toBe("untitled");
  });
});

describe("suggestTargetPath", () => {
  it("suggests a slug inside an existing folder", () => {
    expect(suggestTargetPath("Liquidity model summary", "03-product")).toBe(
      "03-product/liquidity-model-summary.md",
    );
    expect(suggestTargetPath("", "07-governance")).toBe("07-governance/untitled.md");
  });

  it("falls back to the vault root when no folder exists", () => {
    expect(suggestTargetPath("Liquidity model summary")).toBe("liquidity-model-summary.md");
  });
});

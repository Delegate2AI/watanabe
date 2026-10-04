import { describe, it, expect } from "vitest";
import { DEFAULT_DESIGN_HOUSE_STYLE, BUNDLED_FONTS } from "@/lib/agent/design-house-style";
import { MAX_DESIGN_GUIDE_BYTES } from "./config";
import { checkDesignGuide } from "./validate";

/**
 * What an admin cannot save.
 *
 * The split already means no edit reaches the renderer's contract, since the
 * constraints are emitted first from code whatever the guide says. These checks
 * catch the narrower case of guidance that CONTRADICTS the constraints, where
 * the model gets two opposite instructions and the document fails quietly. Each
 * one is a thing nobody can have meant.
 */

function problems(text: string): string[] {
  const result = checkDesignGuide(text);
  return result.ok ? [] : result.problems.map((problem) => problem.reason);
}

describe("checkDesignGuide", () => {
  it("accepts the guide the feature ships with", () => {
    // The load-bearing one. "Restore the built-in guide" writes exactly this,
    // so a rule that rejected it would make the escape hatch unusable.
    expect(checkDesignGuide(DEFAULT_DESIGN_HOUSE_STYLE)).toEqual({ ok: true });
  });

  it("accepts ordinary art direction", () => {
    expect(checkDesignGuide("HOUSE STYLE\n\nOne accent colour. Wide margins.")).toEqual({ ok: true });
  });

  it("refuses an empty guide", () => {
    expect(problems("   \n\n")).toHaveLength(1);
    expect(problems("")[0]).toMatch(/cannot be empty/i);
  });

  it("refuses a guide past the size ceiling, which reaches every system prompt", () => {
    expect(problems("HOUSE\n" + "x".repeat(MAX_DESIGN_GUIDE_BYTES))[0]).toMatch(/limit is/);
  });

  it("refuses asking for script, which runs in neither the frame nor the renderer", () => {
    expect(problems('Add <script src="x"> for interactivity.')[0]).toMatch(/script/i);
  });

  it("refuses a linked web font, which leaves the download in a fallback face", () => {
    expect(problems("Link fonts.googleapis.com for the headings.").join(" ")).toMatch(/outbound|blocks/i);
  });

  it("refuses any URL, because a document that fetches is blank offline", () => {
    expect(problems("Use the logo at https://cdn.example/logo.svg").join(" ")).toMatch(/URL|offline/i);
  });

  it("refuses a font-family the sidecar does not carry", () => {
    const reasons = problems("Set font-family: Comic Sans MS, cursive; on headings.");
    expect(reasons.join(" ")).toContain("comic sans ms");
    expect(reasons.join(" ")).toContain(BUNDLED_FONTS[0]);
  });

  it("accepts a font-family naming a bundled face with a generic fallback", () => {
    expect(checkDesignGuide("Headings use font-family: Fraunces, Georgia, serif;")).toEqual({ ok: true });
    expect(checkDesignGuide('Labels use font-family: "JetBrains Mono", monospace;')).toEqual({ ok: true });
  });

  it("refuses a protocol-relative host, which fetches without naming a scheme", () => {
    expect(problems("Pull the mark from //cdn.example/logo.svg").join(" ")).toMatch(/URL|offline/i);
  });

  it("refuses a guide of zero-width spaces, which trim alone calls non-empty", () => {
    expect(problems("​​⁠")[0]).toMatch(/cannot be empty/i);
  });

  it("checks every font declaration on a line, not just the first", () => {
    const reasons = problems("h1 { font-family: Fraunces; } h2 { font-family: Papyrus; }");
    expect(reasons.join(" ")).toContain("papyrus");
  });

  it("allows a line that FORBIDS the thing it names", () => {
    // An admin reinforcing a constraint was being refused by the rule that
    // agrees with them, which reads as the surface being broken.
    expect(checkDesignGuide("HOUSE STYLE\n\nNever emit a <script> tag.")).toEqual({ ok: true });
    expect(checkDesignGuide("HOUSE STYLE\n\nDo not link fonts.googleapis.com.")).toEqual({ ok: true });
  });

  it("allows a custom property as a font value", () => {
    expect(checkDesignGuide("Body uses font-family: var(--body-font, Inter), serif;")).toEqual({ ok: true });
  });

  it("points at the line, so an admin does not have to hunt for it", () => {
    const result = checkDesignGuide("HOUSE STYLE\nfine\n<script>bad</script>\nfine");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].line).toBe(3);
  });

  it("reports every problem at once rather than one per save", () => {
    const reasons = problems("<script>a</script>\nfonts.googleapis.com\nfont-family: Papyrus;");
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });
});

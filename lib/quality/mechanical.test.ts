import { describe, expect, it } from "vitest";
import { addedLinesFromDiff, checkAddedLines } from "./mechanical";

// research-harness's own check-em-dash.py bans U+2014 (em dash) and U+2015
// (horizontal bar); built from a code point, not a literal character, so
// this test file stays free of the character itself.
const EM_DASH = String.fromCodePoint(0x2014);

describe("checkAddedLines", () => {
  it("flags an added line containing an em dash", () => {
    const violations = checkAddedLines([`Growth accelerated ${EM_DASH} fast.`]);
    expect(violations).toEqual([expect.objectContaining({ line: 1, kind: "em-dash" })]);
  });

  it("flags a work-effort time estimate", () => {
    const violations = checkAddedLines(["This takes 3 days to build"]);
    expect(violations).toEqual([expect.objectContaining({ line: 1, kind: "time-estimate" })]);
  });

  it("flags an unsourced figure", () => {
    const violations = checkAddedLines(["Revenue grew 40% last year"]);
    expect(violations).toEqual([expect.objectContaining({ line: 1, kind: "unsourced-figure" })]);
  });

  it("does not flag a figure cited by a bare vault-relative path", () => {
    expect(checkAddedLines(["Revenue grew 40% (see 04-economy/rev.md)"])).toEqual([]);
  });

  it("does not flag a figure cited by a markdown link", () => {
    expect(checkAddedLines(["Revenue grew [40%](x.md)"])).toEqual([]);
  });

  it("does not flag a figure cited by a URL", () => {
    expect(checkAddedLines(["See https://example.com/report for the 40% figure."])).toEqual([]);
  });

  it("does not flag a number that only appears inside a code span", () => {
    expect(checkAddedLines(["Use `40%` as the placeholder constant name."])).toEqual([]);
  });

  it("does not flag an ordinary calendar duration with no work-effort verb", () => {
    expect(checkAddedLines(["The report covers the 3 months ending in March."])).toEqual([]);
  });

  it("returns no violations for a clean line", () => {
    expect(checkAddedLines(["This is a normal sentence with no issues."])).toEqual([]);
  });

  it("indexes violations by position in the addedLines array, not a file line number", () => {
    const violations = checkAddedLines(["a clean line", `Growth was up ${EM_DASH} big time.`]);
    expect(violations).toEqual([expect.objectContaining({ line: 2, kind: "em-dash" })]);
  });

  it("can report multiple violations on the same line", () => {
    const violations = checkAddedLines([`Revenue up 40% ${EM_DASH} it will take 5 days total.`]);
    const kinds = violations.map((v) => v.kind).sort();
    expect(kinds).toEqual(["em-dash", "time-estimate", "unsourced-figure"]);
  });

  describe("time-estimate: historical vs. work-effort framing", () => {
    it.each([
      "The recession took 6 months to resolve, according to NBER.",
      "The migration took 2 weeks (see eng/postmortem.md).",
      "It took about 3 months for rates to fall.",
    ])("does not flag historical past-tense duration: %s", (text) => {
      expect(checkAddedLines([text])).toEqual([]);
    });

    it.each([
      "This will take 3 days to build.",
      "Takes about 2 weeks to implement.",
      "Roughly 3 days of effort.",
    ])("flags a work-effort estimate: %s", (text) => {
      const violations = checkAddedLines([text]);
      expect(violations).toEqual([expect.objectContaining({ line: 1, kind: "time-estimate" })]);
    });

    it("flags a tilde-prefixed estimate (~ is not a dead branch)", () => {
      const violations = checkAddedLines(["~3 days of effort."]);
      expect(violations).toEqual([expect.objectContaining({ line: 1, kind: "time-estimate" })]);
    });
  });
});

describe("addedLinesFromDiff", () => {
  it("extracts + lines with new-file line numbers, excluding the +++ header", () => {
    const diff = [
      "diff --git a/foo.md b/foo.md",
      "index abc123..def456 100644",
      "--- a/foo.md",
      "+++ b/foo.md",
      "@@ -1,3 +1,4 @@",
      " Line one",
      "-Old line two",
      "+New line two",
      "+Another added line",
      " Line three",
    ].join("\n");

    expect(addedLinesFromDiff(diff)).toEqual([
      { line: 2, text: "New line two" },
      { line: 3, text: "Another added line" },
    ]);
  });

  it("returns an empty array for a diff with no additions", () => {
    const diff = ["--- a/foo.md", "+++ b/foo.md", "@@ -1,2 +1,2 @@", " Line one", " Line two"].join("\n");
    expect(addedLinesFromDiff(diff)).toEqual([]);
  });

  it("tracks line numbers across multiple hunks", () => {
    const diff = [
      "--- a/foo.md",
      "+++ b/foo.md",
      "@@ -1,1 +1,2 @@",
      " Line one",
      "+Added near top",
      "@@ -10,1 +11,2 @@",
      " Line ten",
      "+Added near bottom",
    ].join("\n");

    expect(addedLinesFromDiff(diff)).toEqual([
      { line: 2, text: "Added near top" },
      { line: 12, text: "Added near bottom" },
    ]);
  });

  it("does not misparse an added line whose content starts with ++ as a file header", () => {
    const diff = [
      "--- a/foo.md",
      "+++ b/foo.md",
      "@@ -1,1 +1,3 @@",
      " Line one",
      "+++i is a C++ idiom",
      "+Another added line after it",
    ].join("\n");

    expect(addedLinesFromDiff(diff)).toEqual([
      { line: 2, text: "++i is a C++ idiom" },
      { line: 3, text: "Another added line after it" },
    ]);
  });
});

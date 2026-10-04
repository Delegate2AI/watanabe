import { describe, it, expect } from "vitest";
import { sanitizeMrDescription } from "./mr-description";

/**
 * `sanitizeMrDescription` is the sole guard between agent-authored package
 * report text and GitLab's MR description field: GitLab executes "quick
 * actions" (/merge, /approve, /close, /target_branch, /label, ...) found in
 * an API-created MR description, acting as whatever token created it — the
 * bot's `REPO_WRITE_TOKEN`. Since the report text is derived from an
 * uploaded package (untrusted input the agent read and summarized), a
 * malicious package could plant a leading slash-command to bypass human MR
 * review entirely. This neutralizes any LINE-LEADING slash-command without
 * touching legitimate content that merely contains a slash.
 */

describe("sanitizeMrDescription", () => {
  it("leaves ordinary report text untouched", () => {
    const report = "# Integration report\n\nPlacement table etc.\n";
    expect(sanitizeMrDescription(report)).toBe(report);
  });

  it("neutralizes a line-leading /merge quick action", () => {
    const report = "Some report text.\n/merge\nMore text.\n";
    const out = sanitizeMrDescription(report);
    expect(out).not.toContain("\n/merge\n");
    expect(out).toContain("/merge"); // still visible, just rendered literally
  });

  it("neutralizes a line-leading /approve quick action", () => {
    const report = "/approve\n";
    const out = sanitizeMrDescription(report);
    expect(out.startsWith("/approve")).toBe(false);
  });

  it("neutralizes an indented slash-command line (GitLab tolerates leading whitespace)", () => {
    const report = "Body text\n   /close\nTail\n";
    const out = sanitizeMrDescription(report);
    const lines = out.split("\n");
    expect(lines[1]).not.toBe("   /close");
    expect(lines[1]).toContain("/close");
  });

  it("neutralizes /target_branch and /label quick actions", () => {
    const report = "/target_branch main\n/label ~bug\n";
    const out = sanitizeMrDescription(report);
    const lines = out.split("\n");
    expect(lines[0]).not.toBe("/target_branch main");
    expect(lines[1]).not.toBe("/label ~bug");
  });

  it("does NOT alter a URL that merely contains slashes", () => {
    const report = "See https://gitlab.example/acme/kb for details.\n";
    expect(sanitizeMrDescription(report)).toBe(report);
  });

  it("does NOT alter a markdown mid-line slash (e.g. a fraction or path in prose)", () => {
    const report = "Coverage is 3/4 of the files, see docs/foo/bar.md for the rest.\n";
    expect(sanitizeMrDescription(report)).toBe(report);
  });

  it("does NOT alter a line-leading slash that isn't a word (e.g. just '/' or '//')", () => {
    const report = "/\n//\n/// triple\n";
    expect(sanitizeMrDescription(report)).toBe(report);
  });

  it("does NOT alter a fenced code block's closing slash-less line but DOES neutralize a slash-command even inside prose-looking text", () => {
    // Deliberately conservative: this sanitizer works purely line-by-line
    // over the whole text, including inside fenced code blocks — safety
    // (never letting a quick action execute) takes priority over preserving
    // example code that happens to look like one.
    const report = "```\n/merge\n```\n";
    const out = sanitizeMrDescription(report);
    const lines = out.split("\n");
    expect(lines[1]).not.toBe("/merge");
  });

  it("handles an empty string", () => {
    expect(sanitizeMrDescription("")).toBe("");
  });

  it("neutralizes multiple quick-action lines independently", () => {
    const report = "/merge\ntext\n/close\n";
    const out = sanitizeMrDescription(report);
    const lines = out.split("\n");
    expect(lines[0]).not.toBe("/merge");
    expect(lines[1]).toBe("text");
    expect(lines[2]).not.toBe("/close");
  });
});

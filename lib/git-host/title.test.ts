import { describe, it, expect } from "vitest";
import { splitMergeRequestTitle, MAX_MR_TITLE } from "./title";

describe("splitMergeRequestTitle", () => {
  it("takes the subject line as the title and carries the body into the description", () => {
    const { title, description } = splitMergeRequestTitle("Add the tag block\n\nWhy it matters.\n", "Footer.");
    expect(title).toBe("Add the tag block");
    expect(description).toContain("Why it matters.");
    expect(description).toContain("Footer.");
  });

  it("leaves a one-line message and its description alone", () => {
    const { title, description } = splitMergeRequestTitle("Add a page", "Footer.");
    expect(title).toBe("Add a page");
    expect(description).toBe("Footer.");
  });

  it("truncates a subject line too long for GitLab and keeps the whole message in the body", () => {
    const long = "x".repeat(400);
    const { title, description } = splitMergeRequestTitle(long, "Footer.");
    expect(title.length).toBe(MAX_MR_TITLE);
    expect(title.endsWith("...")).toBe(true);
    expect(description).toContain(long);
  });

  it("falls back to a usable title when the message is only whitespace", () => {
    const { title } = splitMergeRequestTitle("\n\n  \n", "Footer.");
    expect(title.trim().length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(MAX_MR_TITLE);
  });

  it("handles CRLF line endings", () => {
    const { title, description } = splitMergeRequestTitle("Subject here\r\n\r\nBody here.", "Footer.");
    expect(title).toBe("Subject here");
    expect(description).toContain("Body here.");
  });
});

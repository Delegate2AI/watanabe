import { describe, it, expect } from "vitest";
import { buildPublishedNote, normalizeTargetInput, slugifyTitle } from "./note";

describe("normalizeTargetInput", () => {
  it("accepts a docs/-prefixed markdown path and strips the docs/ prefix", () => {
    expect(normalizeTargetInput("docs/notes/risk.md")).toEqual({ ok: true, rel: "notes/risk.md" });
  });

  it("accepts a vault-relative markdown path unchanged", () => {
    expect(normalizeTargetInput("notes/risk.md")).toEqual({ ok: true, rel: "notes/risk.md" });
  });

  it("rejects an absolute path instead of silently making it relative", () => {
    expect(normalizeTargetInput("/etc/passwd.md").ok).toBe(false);
    // A leading slash must NOT be stripped into a relative path.
    expect(normalizeTargetInput("/notes/x.md").ok).toBe(false);
  });

  it("rejects a non-markdown target", () => {
    expect(normalizeTargetInput("docs/notes/x.exe").ok).toBe(false);
    expect(normalizeTargetInput("docs/notes/x").ok).toBe(false);
  });

  it("rejects an empty target", () => {
    expect(normalizeTargetInput("   ").ok).toBe(false);
    expect(normalizeTargetInput("docs/").ok).toBe(false);
  });
});

describe("buildPublishedNote", () => {
  it("emits frontmatter carrying the exact visibility list, then the body", () => {
    const note = buildPublishedNote({ title: "Risk", visibility: ["exec", "board"], body: "# Risk\n\nText." });
    expect(note).toMatch(/^---\n/);
    expect(note).toContain("title: Risk");
    expect(note).toContain("type: note");
    expect(note).toMatch(/visibility:\n\s+- exec\n\s+- board/);
    expect(note).toContain("Text.");
  });

  it("strips any frontmatter the chat body already carried (no double header)", () => {
    const note = buildPublishedNote({
      title: "T",
      visibility: ["all-hands"],
      body: "---\nfoo: bar\n---\n\nReal body.",
    });
    expect(note).not.toContain("foo: bar");
    expect(note).toContain("Real body.");
  });
});

describe("slugifyTitle", () => {
  it("lowercases and dash-joins, falling back to a safe default", () => {
    expect(slugifyTitle("Risk Disclosure!")).toBe("risk-disclosure");
    expect(slugifyTitle("***")).toBe("artifact");
  });
});

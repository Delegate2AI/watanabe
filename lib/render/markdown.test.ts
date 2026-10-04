import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "./markdown";

/**
 * Deriving the markdown copy of a designed document
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * This runs in the app rather than in the render sidecar, which is a deviation
 * from the spec recorded in the implementation notes. It derives from the
 * ORIGINAL body, before the sidecar turns a mermaid fence into a serialized
 * `<svg>`, and it keeps working when the sidecar is down. The KB publish path
 * depends on it, so it must not acquire a network dependency.
 */

describe("htmlToMarkdown", () => {
  it("turns headings and paragraphs into markdown", () => {
    const md = htmlToMarkdown("<h1>Title</h1><p>Some body text.</p>");
    expect(md).toContain("# Title");
    expect(md).toContain("Some body text.");
  });

  it("drops the style block rather than dumping CSS into the prose", () => {
    const md = htmlToMarkdown("<style>h1{color:red}</style><h1>Title</h1>");
    expect(md).not.toContain("color:red");
    expect(md).toContain("# Title");
  });

  it("drops script entirely, so nothing executable survives into a vault note", () => {
    const md = htmlToMarkdown("<script>alert(1)</script><p>text</p>");
    expect(md).not.toContain("alert");
    expect(md).toContain("text");
  });

  it("keeps a table, which is the thing a designed report most often carries", () => {
    const md = htmlToMarkdown(
      "<table><thead><tr><th>Scenario</th><th>Depth</th></tr></thead>" +
        "<tbody><tr><td>Base</td><td>full</td></tr></tbody></table>",
    );
    expect(md).toContain("Scenario");
    expect(md).toContain("Base");
  });

  it("keeps a link and its target", () => {
    const md = htmlToMarkdown('<p>See <a href="https://example.com/x">the note</a>.</p>');
    expect(md).toContain("[the note](https://example.com/x)");
  });

  it("replaces an inline figure with a caption rather than a wall of svg source", () => {
    const svg = '<svg viewBox="0 0 10 10" role="img" aria-label="The Orb"><circle cx="5" cy="5" r="4"/></svg>';
    const md = htmlToMarkdown(`<h1>T</h1>${svg}`);

    expect(md).not.toContain("<circle");
    expect(md).not.toContain("viewBox");
    expect(md).toContain("The Orb");
  });

  it("falls back to a neutral placeholder for a figure with no accessible name", () => {
    const md = htmlToMarkdown('<h1>T</h1><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
    expect(md).not.toContain("<circle");
    expect(md).toMatch(/diagram|figure/i);
  });

  it("returns an empty string for an empty body instead of throwing", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("never throws on input that is not really html", () => {
    expect(() => htmlToMarkdown("<<<not markup at all &&&")).not.toThrow();
  });

  it("collapses the run of blank lines a converted document tends to leave", () => {
    const md = htmlToMarkdown("<h1>A</h1><div></div><div></div><p>B</p>");
    expect(md).not.toMatch(/\n{3,}/);
  });
});

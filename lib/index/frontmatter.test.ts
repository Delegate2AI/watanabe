import { describe, expect, it } from "vitest";
import { parseDoc } from "./frontmatter";

describe("parseDoc", () => {
  it("uses frontmatter when present", () => {
    const d = parseDoc(
      "04-economy/tokenomics.md",
      "---\ntitle: Tokenomics\ndescription: The token model\ntags: [economy, token]\n---\n\nBody."
    );
    expect(d).toEqual({
      path: "04-economy/tokenomics.md",
      title: "Tokenomics",
      description: "The token model",
      tags: ["economy", "token"],
    });
  });

  it("derives title from first heading, description from first paragraph", () => {
    const d = parseDoc("x/score.md", "# Trader Score\n\nHow the score works in detail.\n");
    expect(d.title).toBe("Trader Score");
    expect(d.description).toBe("How the score works in detail.");
    expect(d.tags).toEqual([]);
  });

  it("falls back to filename when no frontmatter or heading", () => {
    const d = parseDoc("notes/raw-idea.md", "just text no heading");
    expect(d.title).toBe("raw idea");
    expect(d.description).toBe("just text no heading");
  });

  it("parses tags as an indented list", () => {
    const d = parseDoc(
      "y/list-tags.md",
      "---\ntitle: List Tags\ntags:\n  - economy\n  - token\n---\n\nBody text here.\n"
    );
    expect(d.tags).toEqual(["economy", "token"]);
  });

  it("handles a colon inside a frontmatter value", () => {
    const d = parseDoc(
      "y/colon.md",
      "---\ntitle: Ratio: A Guide\ndescription: Explains the ratio: how it works\n---\n\nBody.\n"
    );
    expect(d.title).toBe("Ratio: A Guide");
    expect(d.description).toBe("Explains the ratio: how it works");
  });

  it("strips surrounding quotes from a quoted frontmatter scalar", () => {
    const d = parseDoc(
      "y/quoted.md",
      '---\ntitle: "Quoted Title"\ndescription: \'Single quoted description\'\n---\n\nBody.\n'
    );
    expect(d.title).toBe("Quoted Title");
    expect(d.description).toBe("Single quoted description");
  });
});

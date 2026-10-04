import { describe, it, expect } from "vitest";
import { snippetFor, stripFrontmatter, toPlainText } from "./snippet";

describe("stripFrontmatter", () => {
  it("removes only a leading fenced block", () => {
    const out = stripFrontmatter("---\ntitle: Emission Design\nowner: maria.chen@example.com\n---\nBody line.");
    expect(out.trim()).toBe("Body line.");
    expect(out).not.toContain("maria.chen@example.com");
  });

  it("leaves a horizontal rule in the body intact", () => {
    const out = stripFrontmatter("---\ntitle: T\n---\nAbove.\n\n---\n\nBelow.");
    expect(out).toContain("---");
    expect(out).toContain("Above.");
    expect(out).toContain("Below.");
  });

  it("leaves a document with no frontmatter untouched", () => {
    expect(stripFrontmatter("Just prose.\n\n---\n\nMore prose.")).toBe("Just prose.\n\n---\n\nMore prose.");
  });

  it("leaves an unterminated fence untouched rather than eating the document", () => {
    expect(stripFrontmatter("---\ntitle: T\nno closing fence")).toBe("---\ntitle: T\nno closing fence");
  });

  it("tolerates an empty document", () => {
    expect(stripFrontmatter("")).toBe("");
  });
});

describe("toPlainText", () => {
  it("reduces a table row to its cells", () => {
    expect(toPlainText("| `04-economy` | Emissions, fees, treasury | finance |")).toBe(
      "04-economy Emissions, fees, treasury finance",
    );
  });

  it("drops a table delimiter row entirely", () => {
    expect(toPlainText("| a | b |\n| --- | :--- |\n| 1 | 2 |")).toBe("a b 1 2");
  });

  it("drops ATX heading markers", () => {
    expect(toPlainText("## Interaction with emissions")).toBe("Interaction with emissions");
  });

  it("reduces a wikilink list item to its label and prose", () => {
    expect(toPlainText("- [[../04-economy/tokenomics]] - emission curves (finance)")).toBe(
      "tokenomics emission curves (finance)",
    );
  });

  it("prefers a wikilink's alias over its path", () => {
    expect(toPlainText("See [[04-economy/tokenomics|Emission Design]] for detail.")).toBe(
      "See Emission Design for detail.",
    );
  });

  it("reduces a markdown link to its label and an image to its alt text", () => {
    expect(toPlainText("Read [the policy](https://example.com/policy) today.")).toBe(
      "Read the policy today.",
    );
    expect(toPlainText("![Emissions chart](assets/chart.png)")).toBe("Emissions chart");
  });

  it("drops emphasis markers, blockquote markers, and code fences", () => {
    expect(toPlainText("> **Bold** and _italic_ and ~~struck~~")).toBe("Bold and italic and struck");
    expect(toPlainText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("drops a multi-line HTML comment such as a KB-TAG block", () => {
    const body = "Above.\n\n<!-- KB-TAG v1\nkb.id: MERIDIAN-SCORE-SHIP-1\nkb.status: LOCKED\n-->\n\nBelow.";
    expect(toPlainText(body)).toBe("Above. Below.");
  });

  it("drops an unterminated comment through the end of the source", () => {
    expect(toPlainText("Above.\n\n<!-- kb.id: X\nkb.status: LOCKED")).toBe("Above.");
  });

  it("collapses whitespace across lines", () => {
    expect(toPlainText("one\n\n   two\t\tthree  ")).toBe("one two three");
  });

  it("tolerates an empty document", () => {
    expect(toPlainText("")).toBe("");
  });
});

describe("snippetFor", () => {
  const long =
    "Emission curves are set annually by the finance council. " +
    "The treasury holds a reserve against shortfalls. " +
    "Maria owns the schedule and publishes it each quarter. " +
    "Fees accrue to the treasury on every settled trade in the venue.";

  it("centers the window on the first match and marks its offsets", () => {
    const snippet = snippetFor(long, "reserve");
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe("reserve");
    expect(snippet.text).toContain("treasury holds a reserve");
  });

  it("matches case-insensitively but preserves the source casing", () => {
    const snippet = snippetFor(long, "MARIA");
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe("Maria");
  });

  it("never begins mid-word", () => {
    const snippet = snippetFor(long, "settled", 60);
    const firstWord = snippet.text.replace(/^…\s*/, "").split(" ")[0];
    expect(long).toContain(` ${firstWord}`);
  });

  it("keeps the window within maxLen, ellipsis aside", () => {
    const snippet = snippetFor(long, "reserve", 60);
    expect(snippet.text.replace(/…/g, "").trim().length).toBeLessThanOrEqual(60);
  });

  it("falls back to the head of the text when the query is not locatable", () => {
    const snippet = snippetFor(long, "zzz-not-here");
    expect(snippet.matchStart).toBe(0);
    expect(snippet.matchEnd).toBe(0);
    expect(snippet.text.startsWith("Emission curves")).toBe(true);
  });

  it("returns an empty snippet for empty text rather than throwing", () => {
    expect(snippetFor("", "anything")).toEqual({ text: "", matchStart: 0, matchEnd: 0 });
    expect(snippetFor(long, "   ").matchEnd).toBe(0);
  });

  it("returns the whole text when it already fits", () => {
    const snippet = snippetFor("Short body about fees.", "fees");
    expect(snippet.text).toBe("Short body about fees.");
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe("fees");
  });

  it("treats a regex-flavored query as a literal", () => {
    const snippet = snippetFor("The rate is a.b per block.", "a.b");
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe("a.b");
  });
});

describe("snippetFor window bounds", () => {
  it("keeps the match inside the window when the query is longer than the window", () => {
    const query = "a".repeat(200);
    const result = snippetFor(`${query} tail text that follows the very long match`, query, 160);
    expect(result.matchStart).toBeGreaterThanOrEqual(0);
    expect(result.matchEnd).toBeGreaterThan(result.matchStart);
    expect(result.matchEnd).toBeLessThanOrEqual(result.text.length);
  });

  it("never returns a negative offset for a match at the very end", () => {
    const body = `${"filler ".repeat(60)}needle`;
    const result = snippetFor(body, "needle", 40);
    expect(result.matchStart).toBeGreaterThanOrEqual(0);
    expect(result.text.slice(result.matchStart, result.matchEnd).toLowerCase()).toContain("needle");
  });
});

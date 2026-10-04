// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "@/components/ui/markdown";
import { splitInlineAtFirstNewline } from "./callouts";

/**
 * Rendered through the REAL shared pipeline (the client `<Markdown>`, which
 * carries `proseRemarkPlugins`), asserting DOM rather than the mdast tree: the
 * structure is emitted via `data.hName`/`hProperties`, so what matters is the
 * elements and attributes that come out the far end, not the intermediate shape.
 * Same approach as ./highlight.test.tsx.
 */
function md(source: string) {
  return render(<Markdown>{source}</Markdown>).container;
}

describe("callouts", () => {
  it("turns a callout into a div carrying its type, with title and body split", () => {
    const container = md("> [!warning] Do not do this\n> body text");
    const callout = container.querySelector("div.callout");
    expect(callout).toBeTruthy();
    expect(callout?.getAttribute("data-callout")).toBe("warning");
    expect(container.querySelector(".callout-title")?.textContent).toBe("Do not do this");
    // Trimmed: mdast-to-hast pads a block container's children with newlines,
    // exactly as it does inside an ordinary blockquote.
    expect(container.querySelector(".callout-body")?.textContent?.trim()).toBe("body text");
    // No longer a blockquote, so it escapes the quote styling entirely.
    expect(container.querySelector("blockquote")).toBeFalsy();
  });

  it("lowercases the type keyword for the attribute", () => {
    const container = md("> [!WARNING] Shout\n> body");
    expect(container.querySelector(".callout")?.getAttribute("data-callout")).toBe("warning");
  });

  it("keeps inline markup inside an authored title", () => {
    const container = md("> [!note] A **bold** claim and a [link](x.md)\n> body");
    const title = container.querySelector(".callout-title");
    expect(title?.querySelector("strong")?.textContent).toBe("bold");
    expect(title?.querySelector("a")?.getAttribute("href")).toBe("x.md");
    expect(title?.textContent).toBe("A bold claim and a link");
    expect(container.querySelector(".callout-body")?.textContent?.trim()).toBe("body");
  });

  it("falls back to the title-cased keyword when no title is authored", () => {
    expect(md("> [!note]\n> body").querySelector(".callout-title")?.textContent).toBe("Note");
    expect(md("> [!abstract]\n> body").querySelector(".callout-title")?.textContent).toBe(
      "Abstract",
    );
  });

  it("emits no body element for a callout that has none", () => {
    const container = md("> [!tip] Just a title");
    expect(container.querySelector(".callout-title")?.textContent).toBe("Just a title");
    expect(container.querySelector(".callout-body")).toBeFalsy();
  });

  it("makes a fold marker a real details/summary, open only for +", () => {
    const collapsed = md("> [!tip]- Collapsed\n> body");
    const details = collapsed.querySelector("details.callout");
    expect(details).toBeTruthy();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(collapsed.querySelector("summary.callout-title")?.textContent).toBe("Collapsed");

    const expanded = md("> [!tip]+ Expanded\n> body");
    expect((expanded.querySelector("details.callout") as HTMLDetailsElement).open).toBe(true);

    // No marker: a plain div, and nothing foldable.
    const plain = md("> [!tip] Fixed\n> body");
    expect(plain.querySelector("details")).toBeFalsy();
    expect(plain.querySelector("summary")).toBeFalsy();
  });

  it("carries an unrecognized keyword through as-is, for the neutral style", () => {
    const container = md("> [!contraption] Odd one\n> body");
    expect(container.querySelector(".callout")?.getAttribute("data-callout")).toBe("contraption");
    // The keyword never becomes a class: a note cannot author one that styles itself.
    expect(container.querySelector(".contraption")).toBeFalsy();
    expect(container.querySelector(".callout")?.className).toBe("callout");
  });

  it("keeps every block of a multi-block body", () => {
    const container = md("> [!info] Steps\n>\n> first para\n>\n> - one\n> - two");
    const body = container.querySelector(".callout-body");
    expect(body?.querySelectorAll("p").length).toBe(1);
    expect(body?.querySelectorAll("li").length).toBe(2);
  });

  it("finds a callout nested in a list item or inside another callout", () => {
    expect(md("- item\n\n  > [!info] Nested\n").querySelector("li .callout")).toBeTruthy();

    const inner = md("> [!note] Outer\n> body\n>\n> > [!warning] Inner\n> > inner body");
    expect(inner.querySelector(".callout[data-callout='note']")).toBeTruthy();
    expect(
      inner.querySelector(".callout[data-callout='note'] .callout[data-callout='warning']"),
    ).toBeTruthy();
  });

  it("leaves a plain blockquote exactly as it was", () => {
    const container = md("> just a quote\n> over two lines");
    expect(container.querySelector("blockquote")).toBeTruthy();
    expect(container.querySelector(".callout")).toBeFalsy();
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe(
      "just a quote\nover two lines",
    );
  });

  it("needs the marker at the very start of the quote's first paragraph", () => {
    // Mid-quote, so not a callout.
    expect(md("> lead in\n> [!note] not a title").querySelector(".callout")).toBeFalsy();
    // Emphasised, so the first inline child is not the text node holding it.
    expect(md("> **[!note]** x").querySelector(".callout")).toBeFalsy();
    // Not a keyword shape.
    expect(md("> [!123] x").querySelector(".callout")).toBeFalsy();
    expect(md("> [!] x").querySelector(".callout")).toBeFalsy();
  });
});

describe("splitInlineAtFirstNewline", () => {
  it("cuts inside the text node that holds the soft break", () => {
    const [title, body] = splitInlineAtFirstNewline([{ type: "text", value: "Title\nbody" }]);
    expect(title).toEqual([{ type: "text", value: "Title" }]);
    expect(body).toEqual([{ type: "text", value: "body" }]);
  });

  it("carries inline siblings before the cut onto the title side", () => {
    const [title, body] = splitInlineAtFirstNewline([
      { type: "text", value: "A " },
      { type: "strong", children: [{ type: "text", value: "bold" }] },
      { type: "text", value: " claim\nbody" },
    ]);
    expect(title.map((n) => n.type)).toEqual(["text", "strong", "text"]);
    expect(title[2]).toEqual({ type: "text", value: " claim" });
    expect(body).toEqual([{ type: "text", value: "body" }]);
  });

  it("keeps siblings after the cut on the body side", () => {
    const [title, body] = splitInlineAtFirstNewline([
      { type: "text", value: "Title\nbody " },
      { type: "emphasis", children: [{ type: "text", value: "text" }] },
    ]);
    expect(title).toEqual([{ type: "text", value: "Title" }]);
    expect(body.map((n) => n.type)).toEqual(["text", "emphasis"]);
  });

  it("drops an empty half rather than emitting an empty text node", () => {
    // The whole first line was the marker, so the title side is empty and the
    // caller falls back to the keyword.
    expect(splitInlineAtFirstNewline([{ type: "text", value: "\nbody" }])).toEqual([
      [],
      [{ type: "text", value: "body" }],
    ]);
    expect(splitInlineAtFirstNewline([{ type: "text", value: "Title\n" }])).toEqual([
      [{ type: "text", value: "Title" }],
      [],
    ]);
  });

  it("treats a hard break as the end of the line and drops it", () => {
    const [title, body] = splitInlineAtFirstNewline([
      { type: "text", value: "Title" },
      { type: "break" },
      { type: "text", value: "body" },
    ]);
    expect(title).toEqual([{ type: "text", value: "Title" }]);
    expect(body).toEqual([{ type: "text", value: "body" }]);
  });

  it("returns an empty body when there is no line ending at all", () => {
    expect(splitInlineAtFirstNewline([{ type: "text", value: "Title only" }])).toEqual([
      [{ type: "text", value: "Title only" }],
      [],
    ]);
  });
});

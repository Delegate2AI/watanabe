import { describe, expect, it } from "vitest";
import { mermaidSourceOf } from "./mermaid-source";

/** A hast `pre > code` fence, as remark/rehype emits one. */
function fence(language: string | null, source: string, prefix = "language-") {
  return {
    type: "element",
    tagName: "pre",
    children: [
      {
        type: "element",
        tagName: "code",
        properties: language === null ? {} : { className: [`${prefix}${language}`] },
        children: [{ type: "text", value: source }],
      },
    ],
  };
}

describe("mermaidSourceOf", () => {
  it("returns the source of a mermaid fence", () => {
    expect(mermaidSourceOf(fence("mermaid", "graph TD\n  A --> B\n"))).toBe("graph TD\n  A --> B");
  });

  it("accepts the lang- prefix as well as language-", () => {
    expect(mermaidSourceOf(fence("mermaid", "graph TD", "lang-"))).toBe("graph TD");
  });

  it("concatenates split text nodes into one source", () => {
    const node = {
      type: "element",
      tagName: "pre",
      children: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-mermaid"] },
          children: [
            { type: "text", value: "graph TD\n" },
            { type: "text", value: "  A --> B" },
          ],
        },
      ],
    };
    expect(mermaidSourceOf(node)).toBe("graph TD\n  A --> B");
  });

  it("ignores a fence in another language", () => {
    expect(mermaidSourceOf(fence("typescript", "const a = 1;"))).toBeNull();
  });

  it("ignores a fence with no language", () => {
    expect(mermaidSourceOf(fence(null, "plain text"))).toBeNull();
  });

  it("ignores an empty or whitespace-only mermaid fence", () => {
    expect(mermaidSourceOf(fence("mermaid", "   \n  "))).toBeNull();
  });

  it("ignores a pre holding more than one element child", () => {
    const node = {
      type: "element",
      tagName: "pre",
      children: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-mermaid"] },
          children: [{ type: "text", value: "graph TD" }],
        },
        { type: "element", tagName: "code", children: [{ type: "text", value: "graph TD" }] },
      ],
    };
    expect(mermaidSourceOf(node)).toBeNull();
  });

  it("tolerates whitespace text nodes around the code child", () => {
    const node = {
      type: "element",
      tagName: "pre",
      children: [
        { type: "text", value: "\n" },
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-mermaid"] },
          children: [{ type: "text", value: "graph TD" }],
        },
        { type: "text", value: "\n" },
      ],
    };
    expect(mermaidSourceOf(node)).toBe("graph TD");
  });

  it("ignores a node that is not a pre", () => {
    expect(mermaidSourceOf({ type: "element", tagName: "div", children: [] })).toBeNull();
  });

  it("returns null for undefined, null, and non-node input", () => {
    expect(mermaidSourceOf(undefined)).toBeNull();
    expect(mermaidSourceOf(null)).toBeNull();
    expect(mermaidSourceOf("graph TD")).toBeNull();
  });
});

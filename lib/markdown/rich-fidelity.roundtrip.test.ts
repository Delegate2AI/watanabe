// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";
import { richEditorExtensions, markdownStorage } from "./rich-extensions";
import { richEditorBlocker } from "./rich-fidelity";

/**
 * Drive the REAL editor the way the UI does: parse markdown in, serialize it
 * back out. This is what makes `richEditorBlocker` a measurement rather than a
 * guess, in both directions: every construct it allows must survive the trip,
 * and every construct it blocks must still be provably lost.
 */
function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions: richEditorExtensions, content: markdown });
  const out = markdownStorage(editor).getMarkdown();
  editor.destroy();
  return out;
}

describe("rich editor round trip", () => {
  const supported: Record<string, string> = {
    headings: "# One\n\n## Two\n\n### Three",
    emphasis: "Some **bold**, *italic* and ~~struck~~ text.",
    inlineCode: "Open `00-overview/glossary.md` for the rest.",
    link: "See [the doc](00-overview/glossary.md) here.",
    bulletList: "- one\n  - nested\n- two",
    orderedList: "1. first\n2. second",
    blockquote: "> quoted",
    thematicBreak: "before\n\n---\n\nafter",
    fencedCode: "```ts\nconst x = 1;\n```",
    mixed: "## H\n\n**Bold** with a [link](x.md).\n\n- a\n- b\n\n> quote\n\n```js\nx\n```",
  };

  for (const [name, markdown] of Object.entries(supported)) {
    it(`preserves ${name}, which the blocker allows`, () => {
      expect(richEditorBlocker(markdown)).toBeNull();
      expect(roundTrip(markdown)).toBe(markdown);
    });
  }

  it("normalizes authoring variants to their canonical form rather than losing them", () => {
    // Not data loss: the same document, written the one way the serializer
    // emits. Worth pinning so a change in normalization is a visible diff.
    expect(roundTrip("Title\n=====\n\nbody")).toBe("# Title\n\nbody");
    expect(roundTrip("_em_ and __strong__")).toBe("*em* and **strong**");
    expect(roundTrip("+ a\n+ b")).toBe("- a\n- b");
    expect(roundTrip("~~~ts\nx\n~~~")).toBe("```ts\nx\n```");
    expect(roundTrip("    const x = 1;")).toBe("```\nconst x = 1;\n```");
    expect(roundTrip('[doc][ref]\n\n[ref]: x.md "Title"')).toBe('[doc](x.md "Title")');
    expect(roundTrip("<a@example.com>")).toBe("[a@example.com](mailto:a@example.com)");
    expect(roundTrip("Use ``x`` here.")).toBe("Use `x` here.");
  });

  it("is idempotent, so re-opening an artifact does not keep rewriting it", () => {
    for (const markdown of Object.values(supported)) {
      const once = roundTrip(markdown);
      expect(roundTrip(once)).toBe(once);
    }
  });

  const destroyed: Record<string, { markdown: string; gone: string }> = {
    table: { markdown: "| a | b |\n| --- | --- |\n| 1 | 2 |", gone: "|" },
    image: { markdown: "![alt](/img/a.png)", gone: "/img/a.png" },
    refImage: { markdown: "![alt][img]\n\n[img]: /img/a.png", gone: "/img/a.png" },
    shortcutImage: { markdown: "![alt]\n\n[alt]: /img/a.png", gone: "/img/a.png" },
    taskList: { markdown: "- [ ] todo\n- [x] done", gone: "- [ ] todo" },
    orderedTaskList: { markdown: "1. [ ] todo\n2. [x] done", gone: "1. [ ] todo" },
    footnote: { markdown: "Text[^1]\n\n[^1]: the note", gone: "[^1]: the note" },
    fenceInfo: { markdown: "```ts title=setup.ts\nconst x = 1;\n```", gone: "title=setup.ts" },
    quotedTable: { markdown: "> | a | b |\n> | --- | --- |\n> | 1 | 2 |", gone: "|" },
    listedTable: { markdown: "- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |", gone: "|" },
    quotedTaskList: { markdown: "> - [ ] todo", gone: "- [ ] todo" },
    listedFenceInfo: { markdown: "- item\n\n  ```ts title=x\n  y\n  ```", gone: "title=x" },
    escapedBacktickImage: { markdown: "\\`![alt](/img/a.png)\\`", gone: "/img/a.png" },
    doubleEscapedImage: { markdown: "\\\\![alt](/img/a.png)", gone: "/img/a.png" },
    crlfTable: { markdown: "| a | b |\r\n| --- | --- |\r\n| 1 | 2 |", gone: "|" },
    nestedTaskList: { markdown: "- - [ ] todo", gone: "- [ ] todo" },
    inlineFenceThenImage: { markdown: "```code``` is inline.\n\n![alt](/img/a.png)", gone: "/img/a.png" },
    // An Obsidian callout (lib/markdown/callouts.ts) loses twice over: the
    // serializer escapes both brackets, and it collapses the soft break that
    // separates the title from the body. Either one alone stops the renderer
    // seeing a callout, so what comes back is a plain quote of literal text.
    callout: { markdown: "> [!warning] Do not do this\n> body text", gone: "[!warning]" },
    calloutFolded: { markdown: "> [!tip]- Collapsed\n> body text", gone: "[!tip]" },
  };

  for (const [name, { markdown, gone }] of Object.entries(destroyed)) {
    it(`still loses ${name}, which is why the blocker refuses it`, () => {
      expect(richEditorBlocker(markdown)).not.toBeNull();
      expect(roundTrip(markdown)).not.toContain(gone);
    });
  }

  it("still mangles raw HTML, which is why the blocker refuses it", () => {
    // `html: false` keeps the tags out of the schema, so they survive as text
    // rather than as markup: the body comes back entity-escaped, which is a
    // different document than the one the author wrote.
    const markdown = '<div class="x">raw</div>';
    expect(richEditorBlocker(markdown)).toBe("html");
    expect(roundTrip(markdown)).toContain("&lt;div");
  });

  it("still splits a four-backtick fence, which is why the blocker refuses it", () => {
    // The serializer only ever emits three backticks, so the outer fence stops
    // containing the inner one and the block breaks in half.
    const markdown = "````\n```\ninner\n```\n````";
    expect(richEditorBlocker(markdown)).toBe("fenceNested");
    expect(roundTrip(markdown)).not.toContain("````");
  });

  it("still mangles an HTML comment or declaration, which is why the blocker refuses it", () => {
    expect(richEditorBlocker("before\n\n<!-- note -->\n\nafter")).toBe("html");
    expect(roundTrip("before\n\n<!-- note -->\n\nafter")).toContain("&lt;!--");
  });

  it("still mangles frontmatter, which is why the blocker refuses it", () => {
    const markdown = "---\ntitle: x\n---\n\nBody";
    expect(richEditorBlocker(markdown)).toBe("frontmatter");
    expect(roundTrip(markdown)).not.toBe(markdown);
  });
});

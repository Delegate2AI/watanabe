import { describe, it, expect } from "vitest";
import { richEditorBlocker, RICH_BLOCKER_LABELS } from "./rich-fidelity";

describe("richEditorBlocker", () => {
  it("allows the constructs the rich editor can represent", () => {
    const body = [
      "# Title",
      "",
      "Some **bold**, *italic*, ~~struck~~ text with a [link](00-overview/glossary.md)",
      "and `inline code`.",
      "",
      "- one",
      "  - nested",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted",
      "",
      "---",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    expect(richEditorBlocker(body)).toBeNull();
  });

  it("allows an empty body", () => {
    expect(richEditorBlocker("")).toBeNull();
  });

  it("blocks a GFM table, which the rich editor flattens to bare text", () => {
    expect(richEditorBlocker("| a | b |\n| --- | --- |\n| 1 | 2 |\n")).toBe("table");
  });

  it("blocks an image, which the rich editor drops entirely", () => {
    expect(richEditorBlocker("Before\n\n![alt](/img/a.png)\n\nAfter\n")).toBe("image");
  });

  it("blocks a reference-style image, which is dropped just as completely", () => {
    // Every reference form: full, collapsed, and shortcut.
    expect(richEditorBlocker("![alt][img]\n\n[img]: /img/a.png\n")).toBe("image");
    expect(richEditorBlocker("![alt][]\n\n[alt]: /img/a.png\n")).toBe("image");
    expect(richEditorBlocker("![alt]\n\n[alt]: /img/a.png\n")).toBe("image");
  });

  it("blocks a task list, whose checkboxes come back escaped as literal text", () => {
    expect(richEditorBlocker("- [ ] todo\n- [x] done\n")).toBe("taskList");
  });

  it("blocks an ordered task list, in both of its markers", () => {
    expect(richEditorBlocker("1. [ ] todo\n2. [x] done\n")).toBe("taskList");
    expect(richEditorBlocker("1) [ ] todo\n2) [x] done\n")).toBe("taskList");
  });

  it("blocks raw HTML, which loses its tags and attributes", () => {
    expect(richEditorBlocker('Text\n\n<div class="x">raw</div>\n')).toBe("html");
  });

  it("blocks an HTML comment or declaration, which comes back entity-escaped", () => {
    expect(richEditorBlocker("before\n\n<!-- an editorial note -->\n\nafter\n")).toBe("html");
    expect(richEditorBlocker("<!DOCTYPE html>\n\nbody\n")).toBe("html");
    expect(richEditorBlocker("<![CDATA[<tag>]]>\n\nbody\n")).toBe("html");
    expect(richEditorBlocker('<?xml version="1.0"?>\n\nbody\n')).toBe("html");
  });

  it("blocks a construct nested inside a blockquote or a list item", () => {
    // The container prefix used to hide these from the line scans, so a table
    // in a quote or under a bullet reached rich mode and was flattened.
    expect(richEditorBlocker("> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n")).toBe("table");
    expect(richEditorBlocker("- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n")).toBe("table");
    expect(richEditorBlocker("> - [ ] todo\n")).toBe("taskList");
    expect(richEditorBlocker("- item\n\n  ```ts title=x\n  y\n  ```\n")).toBe("fenceInfo");
  });

  it("blocks a table written with Windows line endings", () => {
    // `split("\n")` used to leave a `\r` on every line, which no anchored
    // pattern matched, so a CRLF table walked straight into rich mode.
    expect(richEditorBlocker("| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n")).toBe("table");
  });

  it("blocks a checklist nested directly under another list marker", () => {
    expect(richEditorBlocker("- - [ ] todo\n")).toBe("taskList");
    expect(richEditorBlocker("1. - [x] done\n")).toBe("taskList");
  });

  it("reads a same-line backtick run as inline code, not as a fence opener", () => {
    // CommonMark forbids a backtick in a backtick fence info string, so
    // ```code``` opens nothing: what follows is prose and must still be judged.
    expect(richEditorBlocker("```code``` is inline.\n\n![alt](/img/a.png)\n")).toBe("image");
    expect(richEditorBlocker("```code``` is inline.\n")).toBeNull();
  });

  it("blocks a fence that needs more than three backticks to hold its content", () => {
    // The serializer always emits three, which would split the block in two.
    expect(richEditorBlocker("````\n```\ninner\n```\n````\n")).toBe("fenceNested");
  });

  it("blocks a code fence whose info string carries more than the language", () => {
    // ```ts title=x comes back as ```ts: the rest of the info string is gone.
    expect(richEditorBlocker("```ts title=setup.ts\nconst x = 1;\n```\n")).toBe("fenceInfo");
  });

  it("allows a plain language fence, which round-trips intact", () => {
    expect(richEditorBlocker("```ts\nconst x = 1;\n```\n")).toBeNull();
    expect(richEditorBlocker("```\nplain\n```\n")).toBeNull();
  });

  it("blocks YAML frontmatter, which is re-read as a rule plus a heading", () => {
    expect(richEditorBlocker("---\ntitle: x\nvisibility: all-hands\n---\n\nBody\n")).toBe("frontmatter");
  });

  it("blocks a footnote, which is rewritten into a link", () => {
    expect(richEditorBlocker("Text[^1]\n\n[^1]: the note\n")).toBe("footnote");
  });

  it("blocks a callout, whose brackets come back escaped and whose title merges into the body", () => {
    expect(richEditorBlocker("> [!warning] Do not do this\n> body text\n")).toBe("callout");
    expect(richEditorBlocker("> [!note]\n> body\n")).toBe("callout");
    expect(richEditorBlocker("> [!tip]- Collapsed\n> body\n")).toBe("callout");
    // Nested inside a quote or a list, exactly like every other blocker.
    expect(richEditorBlocker("- item\n\n  > [!info] Heads up\n")).toBe("callout");
  });

  it("does not mistake a plain quote or a quoted code sample for a callout", () => {
    expect(richEditorBlocker("> just a quote\n")).toBeNull();
    // Prose ABOUT callouts: backticked, so the marker is inline code.
    expect(richEditorBlocker("> Write `[!note]` to open one.\n")).toBeNull();
    // Sample text inside a fence is not markup.
    expect(richEditorBlocker("```\n> [!note] sample\n```\n")).toBeNull();
    // Unquoted, so it is literal text that survives the trip either way.
    expect(richEditorBlocker("[!note] not a callout\n")).toBeNull();
  });

  it("does not mistake a thematic break for frontmatter", () => {
    expect(richEditorBlocker("Intro\n\n---\n\nMore\n")).toBeNull();
  });

  it("does not mistake a link for an image", () => {
    expect(richEditorBlocker("See [the doc](a.md) for the rest.\n")).toBeNull();
  });

  it("does not mistake a pipe in prose or a table inside a fence for a table", () => {
    expect(richEditorBlocker("Use `a | b` for the union.\n")).toBeNull();
    expect(richEditorBlocker("```\n| a | b |\n| --- | --- |\n```\n")).toBeNull();
  });

  it("does not mistake an escaped bracket run for a task list", () => {
    expect(richEditorBlocker("- [a link](x.md) in a list\n")).toBeNull();
    expect(richEditorBlocker("1. [a link](x.md) in a list\n")).toBeNull();
  });

  it("counts the full backslash run before treating an image as escaped", () => {
    // `\\![x](y)`: the first backslash escapes the second, so the image is real.
    expect(richEditorBlocker("\\\\![alt](/img/a.png)\n")).toBe("image");
    // A single backslash does escape it, and it renders as literal text.
    expect(richEditorBlocker("\\![alt](/img/a.png)\n")).toBeNull();
  });

  it("does not treat backslash-escaped backticks as a code span", () => {
    // Those backticks are literal text, so the image between them is a real one.
    expect(richEditorBlocker("\\`![alt](/img/a.png)\\`\n")).toBe("image");
  });

  it("does not mistake an image or a tag quoted in inline code for the real thing", () => {
    // A span delimited by a run of backticks is still inline code, and TipTap
    // keeps it, so refusing rich mode over it would be over-blocking.
    expect(richEditorBlocker("Write ``![alt](/img/a.png)`` to embed one.\n")).toBeNull();
    expect(richEditorBlocker("Write ``<div class=\"x\">`` to open one.\n")).toBeNull();
  });

  it("labels every blocker it can return", () => {
    for (const code of [
      "table", "image", "taskList", "html", "frontmatter", "footnote", "callout",
      "fenceInfo", "fenceNested",
    ] as const) {
      expect(RICH_BLOCKER_LABELS[code]).toMatch(/\S/);
    }
  });
});

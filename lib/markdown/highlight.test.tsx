// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "@/components/ui/markdown";

/**
 * The highlighter carries a hand-picked subset of grammars instead of
 * `rehype-highlight`'s bundled `common` set (see ./highlight.ts). These pin the
 * behaviour that swap has to preserve: it is the LANGUAGE LIST that changed, not
 * how highlighting works, and an unregistered language must degrade to plain
 * code rather than throwing inside a chat transcript.
 */
describe("fenced-code highlighting", () => {
  it("highlights a registered language", () => {
    const { container } = render(<Markdown>{"```python\ndef f():\n    pass\n```"}</Markdown>);
    expect(container.querySelector("pre code.hljs")).toBeTruthy();
    expect(container.querySelector("pre code .hljs-keyword")).toBeTruthy();
  });

  it("highlights through a grammar's own aliases", () => {
    const { container } = render(<Markdown>{"```ts\nconst x: number = 1;\n```"}</Markdown>);
    expect(container.querySelector("pre code .hljs-keyword")).toBeTruthy();
  });

  it("renders an unregistered language as plain code instead of throwing", () => {
    const { container } = render(<Markdown>{"```brainfuck\n+[----->+++<]>+.\n```"}</Markdown>);
    const code = container.querySelector("pre code");
    expect(code).toBeTruthy();
    expect(code?.classList.contains("hljs")).toBe(false);
    expect(code?.textContent).toContain("+[----->+++<]>+.");
  });

  it("leaves an unlabeled block alone rather than guessing a grammar", () => {
    const { container } = render(<Markdown>{"```\nconst x = 1;\n```"}</Markdown>);
    expect(container.querySelector("pre code.hljs")).toBeFalsy();
  });

  it("leaves inline code untouched", () => {
    const { container } = render(<Markdown>{"the `const` keyword"}</Markdown>);
    expect(container.querySelector("code.hljs")).toBeFalsy();
    expect(container.querySelector(".hljs-keyword")).toBeFalsy();
  });
});

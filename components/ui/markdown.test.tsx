// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("links an inline code span that names a KB document", () => {
    render(<Markdown>{"See `00-overview/executive-summary.md` for the pitch."}</Markdown>);
    const link = screen.getByRole("link", { name: "00-overview/executive-summary.md" });
    expect(link).toHaveAttribute("href", "/kb/00-overview/executive-summary");
  });

  it("leaves a non-path code span as plain code", () => {
    render(<Markdown>{"run `pnpm dev` to start"}</Markdown>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("pnpm dev").tagName).toBe("CODE");
  });

  it("syntax-highlights a fenced code block", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    // The highlighter tags the code element and emits token spans we can theme.
    expect(container.querySelector("pre code.hljs")).toBeTruthy();
    expect(container.querySelector("pre code .hljs-keyword")).toBeTruthy();
  });

  it("hides an HTML comment instead of printing it as text", () => {
    const body = [
      "<!-- KB-TAG v1",
      "kb.id: MERIDIAN-SCORE-SHIP-1",
      "-->",
      "",
      "visible prose <!-- inline note --> continues",
    ].join("\n");
    const { container } = render(<Markdown>{body}</Markdown>);
    expect(container.textContent).not.toContain("KB-TAG");
    expect(container.textContent).not.toContain("inline note");
    expect(container.textContent).toContain("visible prose");
  });

  it("wraps a table in the horizontal-scroll container", () => {
    const { container } = render(<Markdown>{"| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>);
    const wrap = container.querySelector(".md-table");
    expect(wrap).toBeTruthy();
    expect(wrap?.querySelector("table")).toBeTruthy();
  });
});

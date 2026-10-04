// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Markdown } from "@/components/ui/markdown";

/**
 * End-to-end routing of a ```mermaid fence through the shared prose pipeline's
 * `pre` override. The unit rules for recognizing a fence live in
 * ./mermaid-source.test.ts; these pin the two properties that matter to a
 * reader.
 *
 * The library itself is mocked. Loading real mermaid in jsdom pulls a large
 * dependency and exercises its layout engine, neither of which is what these
 * assert: what matters is that a fence reaches the renderer, that a failure
 * falls back to the source, and that no other code block changed.
 */

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg data-id="${id}"><g>diagram</g></svg>` })),
  },
}));

describe("mermaid fences", () => {
  it("renders a diagram in place of the code block", async () => {
    const { container } = render(<Markdown>{"```mermaid\ngraph TD\n  A --> B\n```"}</Markdown>);
    await waitFor(() => expect(container.querySelector(".md-mermaid svg")).toBeTruthy());
    expect(container.querySelector("pre")).toBeFalsy();
  });

  it("shows the source until the diagram is ready", () => {
    const { container } = render(<Markdown>{"```mermaid\ngraph TD\n  A --> B\n```"}</Markdown>);
    // Synchronously, before the dynamic import resolves: the reader sees exactly
    // the block they saw before diagrams existed, never an empty gap.
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.getAttribute("aria-busy")).toBe("true");
    expect(pre?.textContent).toContain("graph TD");
  });

  it("falls back to the source when the diagram will not parse", async () => {
    const mermaid = (await import("mermaid")).default;
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error"));
    const { container } = render(<Markdown>{"```mermaid\nnot a diagram\n```"}</Markdown>);
    await waitFor(() => expect(container.querySelector("pre")?.getAttribute("aria-busy")).toBe("false"));
    expect(container.querySelector(".md-mermaid")).toBeFalsy();
    expect(container.querySelector("pre code")?.textContent).toContain("not a diagram");
  });

  it("leaves a highlighted code block untouched", () => {
    const { container } = render(<Markdown>{"```python\ndef f():\n    pass\n```"}</Markdown>);
    expect(container.querySelector(".md-mermaid")).toBeFalsy();
    expect(container.querySelector("pre code.hljs")).toBeTruthy();
  });

  it("leaves an unlabeled block as a plain pre", () => {
    const { container } = render(<Markdown>{"```\nplain\n```"}</Markdown>);
    expect(container.querySelector(".md-mermaid")).toBeFalsy();
    expect(container.querySelector("pre code")?.textContent).toContain("plain");
  });

  it("does not treat an empty mermaid fence as a diagram", () => {
    const { container } = render(<Markdown>{"```mermaid\n```"}</Markdown>);
    expect(container.querySelector(".md-mermaid")).toBeFalsy();
    expect(container.querySelector("pre")).toBeTruthy();
  });
});

describe("the zoom viewer", () => {
  const fence = "```mermaid\ngraph TD\n  A --> B\n```";

  it("opens from the control on the diagram and closes again", async () => {
    const user = userEvent.setup();
    const { container } = render(<Markdown>{fence}</Markdown>);
    await waitFor(() => expect(container.querySelector(".md-mermaid svg")).toBeTruthy());

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /zoom viewer/i }));

    const dialog = await screen.findByRole("dialog");
    // The same diagram, carried into the overlay rather than re-rendered.
    expect(dialog.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /reset zoom/i })).toHaveTextContent("100%");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("zooms the diagram from the toolbar and back with reset", async () => {
    const user = userEvent.setup();
    const { container } = render(<Markdown>{fence}</Markdown>);
    await waitFor(() => expect(container.querySelector(".md-mermaid svg")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /zoom viewer/i }));

    const stage = (await screen.findByRole("dialog")).querySelector<HTMLElement>(".md-mermaid-stage");
    // Opens at 1 here because jsdom lays nothing out, so the fit measurement
    // sees a zero-sized box and declines to scale. The fit itself is covered in
    // ./mermaid-zoom.test.ts, where it can be given real numbers.
    expect(stage?.style.transform).toBe("translate(0px, 0px) scale(1)");

    await user.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(screen.getByRole("button", { name: /reset zoom/i })).toHaveTextContent("125%");
    expect(stage?.style.transform).toBe("translate(0px, 0px) scale(1.25)");

    await user.click(screen.getByRole("button", { name: /reset zoom/i }));
    expect(stage?.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("offers no zoom control when the diagram fell back to its source", async () => {
    const mermaid = (await import("mermaid")).default;
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error"));
    const { container } = render(<Markdown>{"```mermaid\nnot a diagram\n```"}</Markdown>);
    await waitFor(() => expect(container.querySelector("pre")?.getAttribute("aria-busy")).toBe("false"));
    expect(screen.queryByRole("button", { name: /zoom viewer/i })).toBeNull();
  });
});

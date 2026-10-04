// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "./diff-view";

const DIFF = [
  "--- a/docs/a.md",
  "+++ b/docs/a.md",
  "@@ -1,3 +1,3 @@",
  " context line",
  "-old line",
  "+new line",
].join("\n");

describe("DiffView", () => {
  it("colours added and removed lines from the shell's own tokens", () => {
    render(<DiffView diff={DIFF} />);

    const added = screen.getByText("+new line");
    expect(added).toHaveClass("bg-good-soft");
    expect(added).toHaveClass("text-good");

    const removed = screen.getByText("-old line");
    expect(removed).toHaveClass("bg-warn-soft");
    expect(removed).toHaveClass("text-warn");
  });

  it("keeps a context line unhighlighted", () => {
    render(<DiffView diff={DIFF} />);
    const context = screen.getByText("context line");
    expect(context).not.toHaveClass("bg-good-soft");
    expect(context).not.toHaveClass("bg-warn-soft");
  });

  it("drops the file header lines, which name paths the card already lists", () => {
    render(<DiffView diff={DIFF} />);
    expect(screen.queryByText(/\+\+\+ b\/docs\/a\.md/)).toBeNull();
    expect(screen.queryByText(/--- a\/docs\/a\.md/)).toBeNull();
  });

  it("renders the hunk header as metadata rather than as a change", () => {
    render(<DiffView diff={DIFF} />);
    const hunk = screen.getByText("@@ -1,3 +1,3 @@");
    expect(hunk).toHaveClass("text-ink-faint");
  });

  it("says so when a change carries no textual diff", () => {
    render(<DiffView diff="" />);
    expect(screen.getByText(/no textual diff/i)).toBeInTheDocument();
  });
});

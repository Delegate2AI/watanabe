// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KbRootGraph } from "./kb-root-graph";

vi.mock("@/components/kb/graph/graph-panel", () => ({
  GraphPanel: () => <div>graph panel</div>,
}));

describe("KbRootGraph", () => {
  it("links to the full map page with the graph view preselected", () => {
    render(<KbRootGraph />);

    expect(screen.getByRole("link", { name: /open full map/i })).toHaveAttribute(
      "href",
      "/map?view=graph",
    );
  });

  // Same constraint as the Graph tab on /map: the canvas needs a definite
  // height from an ancestor or it renders at its 300x150 intrinsic ratio.
  it("gives the graph pane a definite height for the canvas to fill", () => {
    render(<KbRootGraph />);

    expect(screen.getByTestId("kb-root-graph-pane")).toHaveClass("h-[65vh]");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapTabs } from "./map-tabs";

vi.mock("@/components/kb/graph/graph-panel", () => ({
  GraphPanel: () => <div>graph panel</div>,
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/map");
});

describe("MapTabs", () => {
  it("renders the list alone when the graph flag is off", () => {
    render(<MapTabs list={<p>the list</p>} graphEnabled={false} initialView="list" />);

    expect(screen.getByText("the list")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("shows both tabs with the list selected by default", () => {
    render(<MapTabs list={<p>the list</p>} graphEnabled initialView="list" />);

    expect(screen.getByRole("tab", { name: /list/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /graph/i })).toHaveAttribute("aria-selected", "false");
  });

  it("opens on the graph when the URL asks for it", () => {
    render(<MapTabs list={<p>the list</p>} graphEnabled initialView="graph" />);

    expect(screen.getByRole("tab", { name: /graph/i })).toHaveAttribute("aria-selected", "true");
  });

  // A `<canvas>` with no CSS height takes its 300x150 intrinsic ratio, and the
  // canvas container's `h-full` resolves against nothing, so the pane has to get
  // a definite height from this element or it renders at roughly half the
  // column width.
  it("gives the graph pane a definite height for the canvas to fill", () => {
    render(<MapTabs list={<p>the list</p>} graphEnabled initialView="graph" />);

    expect(screen.getByRole("tabpanel")).toHaveClass("h-[70vh]");
  });

  it("writes the tab to the URL without a router navigation", async () => {
    const user = userEvent.setup();
    render(<MapTabs list={<p>the list</p>} graphEnabled initialView="list" />);

    await user.click(screen.getByRole("tab", { name: /graph/i }));

    expect(window.location.search).toBe("?view=graph");
  });
});

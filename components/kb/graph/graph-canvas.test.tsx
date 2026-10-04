// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphCanvas } from "./graph-canvas";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const GRAPH = {
  nodes: [
    { id: "a/one", t: "One", g: "a", d: 1 },
    { id: "a/two", t: "Two", g: "a", d: 1 },
  ],
  edges: [[0, 1]] as [number, number][],
  total: 2,
};

/** Four groups, ranked alpha > beta > gamma > delta, so delta starts unslotted. */
const GROUPED_GRAPH = {
  nodes: [
    { id: "alpha/1", t: "A1", g: "alpha", d: 1 },
    { id: "alpha/2", t: "A2", g: "alpha", d: 1 },
    { id: "alpha/3", t: "A3", g: "alpha", d: 1 },
    { id: "alpha/4", t: "A4", g: "alpha", d: 1 },
    { id: "beta/1", t: "B1", g: "beta", d: 1 },
    { id: "beta/2", t: "B2", g: "beta", d: 1 },
    { id: "beta/3", t: "B3", g: "beta", d: 1 },
    { id: "gamma/1", t: "G1", g: "gamma", d: 1 },
    { id: "gamma/2", t: "G2", g: "gamma", d: 1 },
    { id: "delta/1", t: "D1", g: "delta", d: 1 },
  ],
  edges: [] as [number, number][],
  total: 10,
};

beforeEach(() => {
  // jsdom has no 2D context; the component must not crash without one, and the
  // states below are exactly what a reader sees when it cannot draw.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

describe("GraphCanvas", () => {
  it("shows a loading state while the graph is being fetched", () => {
    render(<GraphCanvas graph={null} loading error={false} onRetry={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("shows an error state with a retry, so the tab is recoverable", () => {
    const onRetry = vi.fn();
    render(<GraphCanvas graph={null} loading={false} error onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: /try again/i });
    retry.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the empty state for a vault with no notes", () => {
    render(
      <GraphCanvas
        graph={{ nodes: [], edges: [], total: 0 }}
        loading={false}
        error={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/knowledge base is empty/i)).toBeInTheDocument();
  });

  it("labels the canvas for a screen reader, which cannot read pixels", () => {
    render(<GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />);

    const canvas = screen.getByRole("img");
    expect(canvas).toHaveAttribute("aria-label", expect.stringContaining("2 notes"));
    expect(canvas).toHaveAttribute("aria-label", expect.stringContaining("1 link"));
  });

  it("says what it is not showing when the node cap trimmed the graph", () => {
    render(
      <GraphCanvas
        graph={{ ...GRAPH, total: 4180 }}
        loading={false}
        error={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/showing 2 of 4,180/i)).toBeInTheDocument();
  });

  it("does not crash when there is no 2D context, and says where to go instead", () => {
    render(<GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />);
    expect(screen.getByText(/list tab/i)).toBeInTheDocument();
  });

  it("never shows the empty-vault message when there is no graph yet", () => {
    // A loose `graph?.nodes.length === 0` guard treats "no graph" the same as
    // "empty graph", which would show this during ordinary loading, not just
    // for a vault that really has zero notes.
    render(<GraphCanvas graph={null} loading={false} error={false} onRetry={() => {}} />);
    expect(screen.queryByText(/knowledge base is empty/i)).not.toBeInTheDocument();
  });

  it("clears the no-2D-context notice on a transition back to loading, rather than latching on forever", () => {
    const { rerender } = render(
      <GraphCanvas graph={GRAPH} loading={false} error={false} onRetry={() => {}} />,
    );
    expect(screen.getByText(/list tab/i)).toBeInTheDocument();

    rerender(<GraphCanvas graph={GRAPH} loading error={false} onRetry={() => {}} />);
    expect(screen.queryByText(/list tab/i)).not.toBeInTheDocument();
  });

  it("pins a group to a colour through the legend, leaving the other slots exactly where they were", () => {
    // Proves the wiring, not just the pure function: `graph-theme.test.ts`
    // already covers `assignGroupSlots` in isolation, but nothing else shows
    // that a click actually reaches it through `useGroupSlots`/`GraphCanvas`.
    render(<GraphCanvas graph={GROUPED_GRAPH} loading={false} error={false} onRetry={() => {}} />);

    expect(screen.getByTestId("swatch-delta")).toHaveAttribute("data-slot", "none");
    const alphaSlot = screen.getByTestId("swatch-alpha").getAttribute("data-slot");
    const betaSlot = screen.getByTestId("swatch-beta").getAttribute("data-slot");

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    expect(screen.getByTestId("swatch-delta")).toHaveAttribute(
      "data-slot",
      expect.stringMatching(/^\d+$/),
    );
    expect(screen.getByTestId("swatch-alpha")).toHaveAttribute("data-slot", alphaSlot);
    expect(screen.getByTestId("swatch-beta")).toHaveAttribute("data-slot", betaSlot);
  });
});

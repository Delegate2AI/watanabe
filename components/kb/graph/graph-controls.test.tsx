// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphControls, loadForces, saveForces } from "./graph-controls";
import { loadShowTasks, saveShowTasks } from "./graph-task-toggle";
import { DEFAULT_FORCES } from "./graph-sim";

const props = {
  query: "",
  onQuery: vi.fn(),
  groups: ["00-overview", "01-planning", "02-product", "meetings"],
  slots: new Map([
    ["00-overview", 0],
    ["01-planning", 1],
    ["02-product", 2],
  ]),
  pinned: new Set<string>(),
  onTogglePin: vi.fn(),
  forces: DEFAULT_FORCES,
  onForces: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("GraphControls", () => {
  it("reports what the reader types in the filter", () => {
    render(<GraphControls {...props} />);
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "emission" } });
    expect(props.onQuery).toHaveBeenCalledWith("emission");
  });

  it("lists every group, including the ones with no colour slot", () => {
    render(<GraphControls {...props} />);
    for (const group of props.groups) {
      expect(screen.getByRole("button", { name: new RegExp(group) })).toBeInTheDocument();
    }
  });

  it("renders a group with no slot as neutral rather than inventing a fourth hue", () => {
    // Asserted on `data-slot`, not on the swatch's colour: jsdom normalises a
    // hex background to `rgb()`, so a "does not contain #2a78d6" assertion
    // passes for a slotted group too and proves nothing.
    render(<GraphControls {...props} />);
    expect(screen.getByTestId("swatch-meetings")).toHaveAttribute("data-slot", "none");
    expect(screen.getByTestId("swatch-00-overview")).toHaveAttribute("data-slot", "0");
    expect(screen.getByTestId("swatch-meetings").style.background).not.toBe("");
  });

  it("names the vault-root group rather than showing an empty legend row", () => {
    render(
      <GraphControls
        {...props}
        groups={["", ...props.groups]}
        slots={new Map([...props.slots, ["", 0]])}
      />,
    );

    // "Vault root" is what `/map`'s list calls the same section.
    const row = screen.getByRole("button", { name: /vault root/i });
    expect(row).toBeInTheDocument();
    expect(screen.getByTestId("swatch-root")).toHaveAttribute("data-slot", "0");

    fireEvent.click(row);
    expect(props.onTogglePin).toHaveBeenCalledWith("");
  });

  it("pins a group to a colour when its legend entry is clicked", () => {
    render(<GraphControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /meetings/i }));
    expect(props.onTogglePin).toHaveBeenCalledWith("meetings");
  });

  it("marks a pinned group as pressed, so the legend reports its own state", () => {
    render(<GraphControls {...props} pinned={new Set(["meetings"])} />);
    expect(screen.getByRole("button", { name: /meetings/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /02-product/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports a force change as the slider moves", () => {
    render(<GraphControls {...props} />);
    fireEvent.change(screen.getByLabelText(/repel force/i), { target: { value: "200" } });
    expect(props.onForces).toHaveBeenCalledWith({ ...DEFAULT_FORCES, repel: 200 });
  });

  // The graph pane clips with `overflow-hidden`, so a panel taller than the
  // pane (an open Forces section, a long legend) loses its bottom controls
  // entirely unless the panel caps its height and scrolls itself.
  it("caps its height to the pane and scrolls, so no section is cut off unreachable", () => {
    render(<GraphControls {...props} />);
    const panel = screen.getByTestId("graph-controls-panel");
    expect(panel).toHaveClass("max-h-[calc(100%-1.5rem)]");
    expect(panel).toHaveClass("overflow-y-auto");
  });

  it("offers the tasks toggle only when the payload actually holds task nodes", () => {
    const { rerender } = render(<GraphControls {...props} />);
    expect(screen.queryByLabelText(/show tasks/i)).not.toBeInTheDocument();

    const onShowTasks = vi.fn();
    rerender(<GraphControls {...props} hasTasks showTasks onShowTasks={onShowTasks} />);
    const toggle = screen.getByLabelText(/show tasks/i);
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(onShowTasks).toHaveBeenCalledWith(false);
  });
});

describe("show-tasks persistence", () => {
  it("defaults to shown and round-trips through localStorage", () => {
    expect(loadShowTasks()).toBe(true);
    saveShowTasks(false);
    expect(loadShowTasks()).toBe(false);
    saveShowTasks(true);
    expect(loadShowTasks()).toBe(true);
  });
});

describe("force persistence", () => {
  it("round-trips through localStorage so tuning survives navigation", () => {
    saveForces({ ...DEFAULT_FORCES, repel: 250 });
    expect(loadForces().repel).toBe(250);
  });

  it("falls back to the defaults on missing or corrupt storage", () => {
    expect(loadForces()).toEqual(DEFAULT_FORCES);
    localStorage.setItem("kb-graph-forces", "not json");
    expect(loadForces()).toEqual(DEFAULT_FORCES);
  });

  it("ignores a stored value that is not a number, rather than feeding NaN to the simulation", () => {
    localStorage.setItem("kb-graph-forces", JSON.stringify({ repel: "lots" }));
    expect(loadForces()).toEqual(DEFAULT_FORCES);
  });

  it("ignores a stored NaN, which would put every node at NaN coordinates", () => {
    localStorage.setItem("kb-graph-forces", JSON.stringify({ ...DEFAULT_FORCES, repel: null }));
    expect(loadForces()).toEqual(DEFAULT_FORCES);
  });
});

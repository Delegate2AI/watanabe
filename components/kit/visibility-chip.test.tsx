// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisibilityChip } from "./visibility-chip";

describe("VisibilityChip", () => {
  it("renders all-hands in the good tone with no lock", () => {
    render(<VisibilityChip visibility="all-hands" />);
    const chip = screen.getByText("All-hands");
    expect(chip).toHaveClass("text-good");
    // no lock icon on an all-hands item
    expect(chip.querySelector("svg")).toBeNull();
  });

  it("renders restricted with the group label, a lock, and the warn tone", () => {
    render(<VisibilityChip visibility="restricted" group="Exec" />);
    // The group label sits in a truncating span inside the warn-toned chip.
    const chip = screen.getByText("Exec").parentElement!;
    expect(chip).toHaveClass("text-warn");
    // lock icon present for a restricted item
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("falls back to a generic restricted label when no group is given", () => {
    render(<VisibilityChip visibility="restricted" />);
    expect(screen.getByText("Restricted").parentElement).toHaveClass("text-warn");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KbTree } from "./kb-tree";
import type { KbTreeNode } from "@/lib/kb/tree";

const nodes: KbTreeNode[] = [
  {
    name: "Overview",
    routeSlug: ["00-overview"],
    isDirectory: true,
    children: [
      { name: "Product Vision", routeSlug: ["00-overview", "vision"], isDirectory: false, visibility: "all-hands" },
    ],
  },
  {
    name: "Exec",
    routeSlug: ["exec"],
    isDirectory: true,
    children: [
      { name: "Comp Plan", routeSlug: ["exec", "comp"], isDirectory: false, visibility: "restricted", group: "Exec" },
    ],
  },
];

describe("KbTree", () => {
  it("renders files as /kb links", () => {
    render(<KbTree nodes={nodes} activeRoute="" />);
    const vision = screen.getByRole("link", { name: /product vision/i });
    expect(vision).toHaveAttribute("href", "/kb/00-overview/vision");
  });

  it("labels a note by its display name and keeps the full text one hover away", () => {
    render(<KbTree nodes={nodes} activeRoute="" />);
    const label = screen.getByText("Product Vision");
    expect(label).toHaveAttribute("title", "Product Vision");
    // Truncation is CSS, so the full string is always in the DOM.
    expect(label.className).toContain("truncate");
  });

  it("puts a note's full title in the hover tooltip when the label is an abbreviated form", () => {
    const meeting: KbTreeNode = {
      name: "18 Aug 12:00 · Daily Sync",
      tooltip: "2026-08-18 12:00 UTC · Daily Sync",
      routeSlug: ["meetings", "2026", "sync"],
      isDirectory: false,
      visibility: "all-hands",
    };
    render(<KbTree nodes={[meeting]} activeRoute="" />);
    const label = screen.getByText("18 Aug 12:00 · Daily Sync");
    expect(label).toHaveAttribute("title", "2026-08-18 12:00 UTC · Daily Sync");
  });

  it("gives the clearance chip its own fixed-width trailing column", () => {
    render(<KbTree nodes={nodes} activeRoute="" />);
    const column = screen.getByTestId("kb-tree-chip-column");
    expect(column.className).toContain("shrink-0");
    expect(column.className).toMatch(/\bw-16\b/);
  });

  it("shows a restricted chip for a restricted-but-present note", () => {
    render(<KbTree nodes={nodes} activeRoute="" />);
    // The restricting group's chip label appears in the tree.
    expect(screen.getByTestId("kb-tree-chip-column")).toHaveTextContent("Exec");
  });

  it("marks the active note", () => {
    render(<KbTree nodes={nodes} activeRoute="00-overview/vision" />);
    const vision = screen.getByRole("link", { name: /product vision/i });
    expect(vision).toHaveAttribute("aria-current", "page");
  });

  it("renders nothing sensitive for an absent note (it is simply not in the nodes)", () => {
    render(<KbTree nodes={nodes} activeRoute="" />);
    expect(screen.queryByText(/board/i)).toBeNull();
  });

  it("renders each section as a collapsible <details> disclosure, open by default (F-05)", () => {
    const { container } = render(<KbTree nodes={nodes} activeRoute="" />);
    const sections = container.querySelectorAll("details");
    expect(sections.length).toBe(2);
    sections.forEach((section) => expect(section).toHaveAttribute("open"));
    // The section header is a real <summary> toggle, not an inert <div>.
    expect(screen.getByText("Overview").closest("summary")).not.toBeNull();
  });

  it("renders the access button only in manage mode", () => {
    const manageNodes: KbTreeNode[] = [
      { name: "Fee Schedule", routeSlug: ["09-finance", "fees"], isDirectory: false, path: "09-finance/fees.md", visibility: "all-hands" },
    ];
    const { rerender } = render(<KbTree nodes={manageNodes} activeRoute="" manage={false} groups={["exec"]} />);
    expect(screen.queryByLabelText(/edit access/i)).toBeNull();
    rerender(<KbTree nodes={manageNodes} activeRoute="" manage groups={["exec"]} />);
    expect(screen.getByLabelText(/edit access/i)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KbLayout } from "./kb-layout";
import type { KbTreeNode } from "@/lib/kb/tree";

vi.mock("next/navigation", () => ({ usePathname: () => "/kb" }));

const nodes: KbTreeNode[] = [
  { name: "vision.md", routeSlug: ["vision"], isDirectory: false, visibility: "all-hands" },
];

/**
 * Guards the flag-off/non-admin byte-identical invariant (spec: KB file access
 * admin UI): the "Manage access" toggle is the only thing `isAdmin` controls
 * in this component, so its presence must track `isAdmin` exactly regardless
 * of `manage`.
 */
describe("KbLayout", () => {
  it("renders the Manage access link when isAdmin is true", () => {
    render(
      <KbLayout tree={nodes} activeRoute="" isAdmin>
        <div />
      </KbLayout>,
    );
    expect(screen.getByRole("link", { name: /manage access/i })).toBeInTheDocument();
  });

  it("omits the Manage access link when isAdmin is false (flag off or non-admin)", () => {
    render(
      <KbLayout tree={nodes} activeRoute="" isAdmin={false}>
        <div />
      </KbLayout>,
    );
    expect(screen.queryByRole("link", { name: /manage access/i })).toBeNull();
  });

  it("defaults isAdmin to false when the prop is omitted", () => {
    render(
      <KbLayout tree={nodes} activeRoute="">
        <div />
      </KbLayout>,
    );
    expect(screen.queryByRole("link", { name: /manage access/i })).toBeNull();
  });

  it("shows Done managing instead of Manage access once already in manage mode", () => {
    render(
      <KbLayout tree={nodes} activeRoute="" isAdmin manage>
        <div />
      </KbLayout>,
    );
    expect(screen.getByRole("link", { name: /done managing/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^manage access$/i })).toBeNull();
  });

  // Entering the mode keeps the open note, so leaving it has to as well. The
  // toggle used to be a fixed pair of hrefs, which dropped the note both ways.
  it("keeps the open note when entering manage mode", () => {
    render(
      <KbLayout tree={nodes} activeRoute="00-overview/glossary" basePath="/kb/00-overview/glossary" isAdmin>
        <div />
      </KbLayout>,
    );
    expect(screen.getByRole("link", { name: /manage access/i })).toHaveAttribute(
      "href",
      "/kb/00-overview/glossary?manage=1",
    );
  });

  it("keeps the open note when leaving manage mode, and actually leaves it", () => {
    render(
      <KbLayout tree={nodes} activeRoute="00-overview/glossary" basePath="/kb/00-overview/glossary" isAdmin manage>
        <div />
      </KbLayout>,
    );
    // No `manage=1`: the old href kept the query and dropped the path, which is
    // exactly backwards, so the control never left the mode.
    expect(screen.getByRole("link", { name: /done managing/i })).toHaveAttribute(
      "href",
      "/kb/00-overview/glossary",
    );
  });

  it("falls back to the KB root when no note is open", () => {
    render(
      <KbLayout tree={nodes} activeRoute="" isAdmin>
        <div />
      </KbLayout>,
    );
    expect(screen.getByRole("link", { name: /manage access/i })).toHaveAttribute("href", "/kb?manage=1");
  });
});

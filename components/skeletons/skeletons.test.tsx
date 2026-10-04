// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./skeleton";
import { ThreadSkeleton } from "./thread-skeleton";
import { ListSkeleton } from "./list-skeleton";
import { GridSkeleton } from "./grid-skeleton";
import { PageSkeleton } from "./page-skeleton";

describe("Skeleton", () => {
  it("renders a decorative bar that assistive technology skips", () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar.className).toContain("h-4");
  });
});

describe("ThreadSkeleton", () => {
  it("announces that it is loading rather than asserting the thread is empty", () => {
    render(<ThreadSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleName(/loading/i);
  });

  it("never renders the chat empty-state sentence", () => {
    render(<ThreadSkeleton />);
    expect(screen.queryByText(/ask watanabe anything/i)).not.toBeInTheDocument();
  });

  it("renders one placeholder per requested turn", () => {
    const { container } = render(<ThreadSkeleton turns={4} />);
    expect(container.querySelectorAll("[data-skeleton-turn]")).toHaveLength(4);
  });
});

describe("ListSkeleton", () => {
  it("announces that it is loading", () => {
    render(<ListSkeleton />);
    expect(screen.getByRole("status")).toHaveAccessibleName(/loading/i);
  });

  it("renders the requested number of rows", () => {
    const { container } = render(<ListSkeleton rows={5} />);
    expect(container.querySelectorAll("[data-skeleton-row]")).toHaveLength(5);
  });

  it("indents its rows when used as a tree placeholder", () => {
    const { container } = render(<ListSkeleton rows={3} tree />);
    const rows = container.querySelectorAll("[data-skeleton-row]");
    expect(rows).toHaveLength(3);
    // A tree reads as a hierarchy, so the placeholder rows must not all be the
    // same width, otherwise the shape of what is loading is a lie.
    const widths = new Set(Array.from(rows, (r) => (r as HTMLElement).style.width));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe("GridSkeleton", () => {
  it("announces that it is loading", () => {
    render(<GridSkeleton />);
    expect(screen.getByRole("status")).toHaveAccessibleName(/loading/i);
  });

  it("renders the requested number of cards", () => {
    const { container } = render(<GridSkeleton cards={6} />);
    expect(container.querySelectorAll("[data-skeleton-card]")).toHaveLength(6);
  });
});

describe("PageSkeleton", () => {
  it("leaves the single loading announcement to the body skeleton it wraps", () => {
    render(
      <PageSkeleton>
        <ListSkeleton label="Loading your meetings" />
      </PageSkeleton>,
    );
    // One live region for the route, not one per placeholder block: the header
    // bars are decoration and must not announce themselves.
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAccessibleName("Loading your meetings");
  });

  it("holds the route's own column width so content does not jump on arrival", () => {
    const { container } = render(<PageSkeleton wide />);
    expect((container.firstElementChild as HTMLElement).className).toContain("max-w-6xl");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThreadLists } from "./thread-lists";

function stub(threads: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ threads }), { status: ok ? 200 : 500 })) as unknown as typeof fetch,
  );
}

describe("ThreadLists", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("splits fetched threads into Pinned and Recents groups", async () => {
    stub([
      { id: "s1", title: "Recent one", updatedAt: "2026-07-08T00:00:00Z", pinned: false },
      { id: "s2", title: "Pinned one", updatedAt: "2026-07-07T00:00:00Z", pinned: true },
    ]);
    render(<ThreadLists />);
    expect(await screen.findByText("Pinned one")).toBeInTheDocument();
    expect(screen.getByText("Recent one")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Recents")).toBeInTheDocument();
    // The pinned thread links to its chat route.
    expect(screen.getByText("Pinned one").closest("a")).toHaveAttribute("href", "/chat/s2");
  });

  it("refetches when a new chat announces itself, so it appears without a reload", async () => {
    // A chat started from Home creates its thread mid-stream with no navigation
    // to re-render the server-seeded list, so Recents used to stay stale until
    // the user reloaded the page.
    const seeded = [{ id: "s1", title: "Older chat", updatedAt: "2026-07-08T00:00:00Z", pinned: false }];
    stub([
      { id: "s2", title: "Brand new chat", updatedAt: "2026-07-09T00:00:00Z", pinned: false },
      ...seeded,
    ]);
    render(<ThreadLists initialThreads={seeded} />);
    expect(screen.getByText("Older chat")).toBeInTheDocument();
    expect(screen.queryByText("Brand new chat")).not.toBeInTheDocument();

    window.dispatchEvent(new Event("watanabe:threads-changed"));
    expect(await screen.findByText("Brand new chat")).toBeInTheDocument();
  });

  it("hides the Pinned group when nothing is pinned", async () => {
    stub([{ id: "s1", title: "Only recent", updatedAt: "2026-07-08T00:00:00Z", pinned: false }]);
    render(<ThreadLists />);
    expect(await screen.findByText("Only recent")).toBeInTheDocument();
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("renders empty (Recents only) on a failed fetch, never throwing", async () => {
    stub(null, false);
    render(<ThreadLists />);
    await waitFor(() => expect(screen.getByText("Recents")).toBeInTheDocument());
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("renders a skeleton while the thread list is in flight, not an empty Recents group", () => {
    stub([{ id: "s1", title: "Recent one", updatedAt: "2026-07-08T00:00:00Z", pinned: false }]);
    render(<ThreadLists />);
    expect(screen.getByRole("status")).toHaveAccessibleName(/loading/i);
    // "View all" belongs to a loaded list: offering it over a skeleton implies
    // there is a list behind it, which is not yet known.
    expect(screen.queryByText("View all")).not.toBeInTheDocument();
  });

  it("drops the skeleton once the threads arrive", async () => {
    stub([{ id: "s1", title: "Recent one", updatedAt: "2026-07-08T00:00:00Z", pinned: false }]);
    render(<ThreadLists />);
    expect(await screen.findByText("Recent one")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("View all")).toBeInTheDocument();
  });

  it("drops the skeleton on a failed fetch rather than loading forever", async () => {
    stub(null, false);
    render(<ThreadLists />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByText("View all")).toBeInTheDocument();
  });

  it("renders the server-provided list immediately, with no skeleton and no fetch", () => {
    stub([]);
    render(
      <ThreadLists
        initialThreads={[
          { id: "s1", title: "From the server", updatedAt: "2026-08-05T00:00:00Z", pinned: false },
          { id: "s2", title: "Pinned server", updatedAt: "2026-08-04T00:00:00Z", pinned: true },
        ]}
      />,
    );
    // Synchronous, not `findByText`: the layout already read this list during
    // the page's own request, so there is nothing to wait for.
    expect(screen.getByText("From the server")).toBeInTheDocument();
    expect(screen.getByText("Pinned server")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adopts a newer server list on a re-render", () => {
    stub([]);
    const { rerender } = render(
      <ThreadLists
        initialThreads={[
          { id: "s1", title: "Before", updatedAt: "2026-08-05T00:00:00Z", pinned: false },
        ]}
      />,
    );
    // What a router.refresh() hands down: same component, newer server data.
    rerender(
      <ThreadLists
        initialThreads={[
          { id: "s1", title: "Before", updatedAt: "2026-08-05T00:00:00Z", pinned: false },
          { id: "s2", title: "After", updatedAt: "2026-08-06T00:00:00Z", pinned: false },
        ]}
      />,
    );
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

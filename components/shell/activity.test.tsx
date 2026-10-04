// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let route = "/";
vi.mock("next/navigation", () => ({ usePathname: () => route }));

const { Activity } = await import("./activity");

const feed = {
  tasks: [{
    id: "task-1",
    title: "Review follow-up",
    href: "/tasks",
    createdAt: "2026-07-11T13:00:00.000Z",
    visibility: "restricted" as const,
    group: "Exec",
  }],
  meetings: [],
  sharedDocs: [{
    id: "doc-1",
    title: "Onboarding checklist",
    href: "/docs/doc-1",
    createdAt: "2026-07-11T09:00:00.000Z",
    visibility: "restricted" as const,
    group: "Shared with you",
  }],
  accessRequests: [],
  taskComments: [],
  unreadCount: 2,
};

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ lastSeenAt: "now" }));
    return new Response(JSON.stringify(feed));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function seenCalls(fetchMock: ReturnType<typeof stubFetch>): unknown[][] {
  return fetchMock.mock.calls.filter(([input]) => String(input) === "/api/activity/seen");
}

beforeEach(() => {
  route = "/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Activity", () => {
  it("marks nothing seen when the panel is opened", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<Activity enabled />);

    expect(await screen.findByText("2 new items")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /activity/i }));

    expect(await screen.findByText("Review follow-up")).toBeInTheDocument();
    expect(seenCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByText("2 new items")).toBeInTheDocument();
  });

  it("clears the unread state only when mark all seen is pressed", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<Activity enabled />);

    expect(await screen.findByText("2 new items")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /activity/i }));
    await user.click(await screen.findByRole("button", { name: /mark all seen/i }));

    await waitFor(() => expect(screen.queryByText("2 new items")).not.toBeInTheDocument());
    expect(seenCalls(fetchMock)).toEqual([["/api/activity/seen", { method: "POST" }]]);
  });

  it("retires only the item that was clicked through", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<Activity enabled />);

    expect(await screen.findByText("2 new items")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /activity/i }));
    await user.click(await screen.findByText("Review follow-up"));

    expect(await screen.findByText("1 new item")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByText("Onboarding checklist")).toBeInTheDocument();
    expect(screen.queryByText("Review follow-up")).not.toBeInTheDocument();
    expect(seenCalls(fetchMock)).toHaveLength(0);
  });

  it("closes the panel on a route change", async () => {
    stubFetch();
    const user = userEvent.setup();
    const { rerender } = render(<Activity enabled />);

    await user.click(await screen.findByRole("button", { name: /activity/i }));
    expect(screen.getByRole("dialog", { name: /what's new/i })).toBeInTheDocument();

    route = "/tasks";
    rerender(<Activity enabled />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the panel on an outside click", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<><Activity enabled /><button type="button">Elsewhere</button></>);

    await user.click(await screen.findByRole("button", { name: /activity/i }));
    expect(screen.getByRole("dialog", { name: /what's new/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the unread dot when the count is zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tasks: [], meetings: [], sharedDocs: [], accessRequests: [], taskComments: [], unreadCount: 0,
    }))));
    render(<Activity enabled />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/new item/)).not.toBeInTheDocument();
  });

  it("lists access requests under their own heading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...feed,
      accessRequests: [{
        id: "r1",
        title: "Budget",
        href: "/docs/d9",
        createdAt: "2026-08-23T00:00:00.000Z",
        visibility: "restricted",
        group: "Access requested",
      }],
      unreadCount: 3,
    }))));
    const user = userEvent.setup();
    render(<Activity enabled />);
    await user.click(await screen.findByRole("button", { name: /activity/i }));

    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Budget/ })).toHaveAttribute("href", "/docs/d9");
  });

  it("survives a payload with no access-request group, as a rollout produces", async () => {
    const older: Record<string, unknown> = { ...feed };
    delete older.accessRequests;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(older))));
    render(<Activity enabled />);
    expect(await screen.findByText("2 new items")).toBeInTheDocument();
  });

  it("renders nothing and makes no request when disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<Activity />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

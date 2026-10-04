// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskCard } from "./task-card";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: pushMock }) }));

const task = {
  id: "t1",
  title: "Send revised deck",
  description: "Send it to the reviewers.",
  assigneeEmail: "alice@example.com",
  assignees: ["alice@example.com"],
  sourceMeetingId: "circleback:m1",
  sourceNotePath: "docs/meetings/2026/review.md",
  clearance: ["exec"],
  sourceAttendees: [],
  status: "proposed" as const,
  due: "2026-07-15",
  origin: "circleback" as const,
  createdBy: null,
  createdAt: "2026-07-11T12:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  refreshMock.mockClear();
  pushMock.mockClear();
});

describe("TaskCard", () => {
  it("shows source, inherited visibility, assignee, due date, and status", () => {
    // The due label is relative, so the clock is pinned. Local-time, not UTC:
    // a date-only due is a calendar day, and only a local pin makes the delta
    // the same number in every timezone the suite might run in.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00"));
    try {
      render(<TaskCard task={task} />);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText(task.title)).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("in 2 days")).toBeInTheDocument();
    expect(screen.getByTitle("15 Jul 2026")).toHaveAttribute("datetime", "2026-07-15");
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source meeting" })).toHaveAttribute("href", "/kb/meetings/2026/review");
  });

  it("renders a manual task with no source note without a Source meeting link or a crash", () => {
    render(
      <TaskCard
        task={{ ...task, sourceMeetingId: null, sourceNotePath: null, origin: "manual", status: "open" }}
      />,
    );
    expect(screen.getByText(task.title)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Source meeting" })).not.toBeInTheDocument();
  });

  it("triages an unassigned task with a member dropdown, not a free-text email box", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskCard task={{ ...task, assigneeEmail: null, assignees: [] }} members={["alice@example.com", "bob@example.com"]} />);

    // No raw email textbox; the assignee is picked from the known roster.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Assign to a team member"), "bob@example.com");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "assign", assignees: ["bob@example.com"] }),
    }));
  });

  it("formats a full ISO-8601 due timestamp as a relative day, not Invalid Date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00"));
    try {
      render(<TaskCard task={{ ...task, due: "2026-07-18T09:00:00.000Z" }} />);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText(/^in \d+ days$/)).toBeInTheDocument();
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
  });

  it("flags an overdue due date so a slipped task does not read like a future one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00"));
    try {
      render(<TaskCard task={task} />);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText("5 days ago")).toHaveClass("text-warn");
  });

  it("posts an accept action and reports the update", async () => {
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskCard task={task} onUpdated={onUpdated} />);

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "accept" }),
    }));
    expect(onUpdated).toHaveBeenCalledWith("t1", "open");
    // Refresh the server component so the card reflects the new status and a
    // second click can't hit an already-transitioned task ("invalid transition").
    expect(refreshMock).toHaveBeenCalled();
  });

  it("starts a new chat seeded with the task context", async () => {
    const user = userEvent.setup();
    render(<TaskCard task={task} />);
    await user.click(screen.getByRole("button", { name: /discuss in chat/i }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/chat\/.+\?q=/);
    const seed = decodeURIComponent(url.split("?q=")[1]);
    expect(seed).toContain("Send revised deck");
    expect(seed).toContain("docs/meetings/2026/review.md");
  });
  // The project card shares the lifecycle with the task list: `move` into done
  // already accepted in_progress, so the checkbox has to be there too.
  it("offers the completion checkbox to the assignee of an in progress task", () => {
    render(<TaskCard task={{ ...task, status: "in_progress" }} actorEmail="alice@example.com" />);
    expect(screen.getByRole("checkbox", { name: "Mark complete" })).toBeInTheDocument();
  });

  // canTransition refuses anyone but the assignee, so a box offered to someone
  // else could only ever fail on click.
  it("withholds it from a non-assignee and from an unassigned task", () => {
    const { unmount } = render(<TaskCard task={{ ...task, status: "open" }} actorEmail="bob@example.com" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    unmount();
    render(<TaskCard task={{ ...task, status: "in_progress", assigneeEmail: null, assignees: [] }} actorEmail="alice@example.com" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("still shows the filled check on a done task to everyone", () => {
    render(<TaskCard task={{ ...task, status: "done" }} actorEmail="bob@example.com" />);
    expect(screen.getByRole("checkbox", { name: "Completed" })).toBeInTheDocument();
  });
});

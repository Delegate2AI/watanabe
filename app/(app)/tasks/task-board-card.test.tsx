// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { TaskBoardCard } from "./task-board-card";

const onChanged = vi.fn();
const fetchMock = vi.fn(async () => Response.json({ ok: true }));

function task(status: TaskStatus): TaskRecord {
  return {
    id: "t1",
    title: "Send revised deck",
    description: "Send it to the reviewers.",
    assigneeEmail: "alice@example.com",
    assignees: ["alice@example.com"],
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["all-hands"],
    sourceAttendees: [],
    status,
    due: null,
    origin: "manual",
    projectId: null,
    createdBy: "alice@example.com",
    createdAt: "2026-07-23T12:00:00Z",
  };
}

function card(status: TaskStatus, commentCount?: number, canTriage = true) {
  return render(
    <TaskBoardCard
      task={task(status)}
      members={["alice@example.com"]}
      people={{}}
      canTriage={canTriage}
      commentCount={commentCount}
      onChanged={onChanged}
    />,
  );
}

/** The move requests only, so an incidental reassign PATCH cannot pass for one. */
function moves(): string[] {
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    .filter((body) => body.action === "move")
    .map((body) => body.status);
}

beforeEach(() => {
  onChanged.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TaskBoardCard", () => {
  it("has no Back or Forward buttons: dragging moves a card now", () => {
    card("open");
    // By label and by text: the buttons carried an aria-label, so a role query
    // on the visible word alone would pass while they were still on the card.
    expect(screen.queryByRole("button", { name: "Move to previous column" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move to next column" })).toBeNull();
    expect(screen.queryByText("Back")).toBeNull();
    expect(screen.queryByText("Forward")).toBeNull();
  });

  it("moves the focused card with the arrow keys, the keyboard path drag cannot offer", async () => {
    const user = userEvent.setup();
    card("open");
    screen.getByRole("article").focus();
    await user.keyboard("{ArrowRight}");
    expect(moves()).toEqual(["in_progress"]);
  });

  it("stops at both ends of the board", async () => {
    const user = userEvent.setup();
    const view = card("open");
    screen.getByRole("article").focus();
    await user.keyboard("{ArrowLeft}");
    view.unmount();

    card("done");
    screen.getByRole("article").focus();
    await user.keyboard("{ArrowRight}");
    expect(moves()).toEqual([]);
  });

  it("leaves the arrow keys alone inside the assignee select", async () => {
    const user = userEvent.setup();
    card("open");
    screen.getByRole("combobox", { name: "Assignee" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(moves()).toEqual([]);
  });

  it("keeps inbox cards on Accept and Dismiss, with no arrow move", async () => {
    const user = userEvent.setup();
    card("proposed");
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    const article = screen.getByRole("article");
    expect(article).not.toHaveAttribute("tabindex");
    article.focus();
    await user.keyboard("{ArrowRight}");
    expect(moves()).toEqual([]);
  });

  it("shows the comment count when there is one", () => {
    card("open", 3);
    expect(screen.getByLabelText(/3 comments/i)).toBeTruthy();
  });

  it("uses the singular label at a count of one", () => {
    card("open", 1);
    expect(screen.getByLabelText("1 comment")).toBeTruthy();
    expect(screen.queryByLabelText("1 comments")).toBeNull();
  });

  it("shows nothing when the count is zero or absent", () => {
    card("open", 0);
    expect(screen.queryByLabelText(/comments/i)).toBeNull();
  });

  it("keeps the assignee select for an actionable task", () => {
    card("open");
    // The picker shows who is already on the task as a removable chip AND the
    // select that adds another, so the chip is expected here, not absent.
    expect(screen.getByRole("combobox", { name: "Assignee" })).toBeInTheDocument();
    expect(screen.getByTitle("alice@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove alice@example.com" })).toBeInTheDocument();
  });

  it("replaces the select with an assignee chip for a done task", () => {
    card("done");
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    expect(screen.getByTitle("alice@example.com")).toBeInTheDocument();
  });

  it("replaces the select with an assignee chip for a dismissed task", () => {
    card("dismissed");
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    expect(screen.getByTitle("alice@example.com")).toBeInTheDocument();
  });

  it("replaces the select with an assignee chip for inbox cards without triage rights", () => {
    card("proposed", undefined, false);
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    expect(screen.getByTitle("alice@example.com")).toBeInTheDocument();
  });

  it("clamps the description to two lines", () => {
    const { container } = card("open");
    expect(container.querySelector("p.line-clamp-2")).toBeInTheDocument();
  });
  // Finished work is nobody's queue, so the unassigned chip must not keep
  // asking for triage once the card lands in Done.
  it("labels an unassigned done card Unassigned, not Needs triage", () => {
    render(
      <TaskBoardCard
        task={{ ...task("done"), assigneeEmail: null, assignees: [] }}
        members={["alice@example.com"]}
        people={{}}
        canTriage
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByText("Needs triage")).not.toBeInTheDocument();
  });

  it("keeps asking for triage on an unassigned inbox card", () => {
    render(
      <TaskBoardCard
        task={{ ...task("proposed"), assigneeEmail: null, assignees: [] }}
        members={["alice@example.com"]}
        people={{}}
        canTriage={false}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText("Needs triage")).toBeInTheDocument();
  });
});

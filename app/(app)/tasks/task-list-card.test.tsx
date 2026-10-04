// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { TaskListCard } from "./task-list-card";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn(async () => Response.json({ ok: true }));

function task(overrides: Partial<TaskRecord> & { status: TaskStatus }): TaskRecord {
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
    due: null,
    origin: "manual",
    projectId: null,
    createdBy: "alice@example.com",
    createdAt: "2026-07-23T12:00:00Z",
    ...overrides,
  };
}

function card(overrides: Partial<TaskRecord> & { status: TaskStatus }, canTriage = true) {
  return render(
    <TaskListCard
      task={task(overrides)}
      members={["alice@example.com"]}
      people={{}}
      actorEmail="alice@example.com"
      viewerClearance={["all-hands"]}
      canTriage={canTriage}
    />,
  );
}

beforeEach(() => {
  refresh.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function leftSlot(container: HTMLElement): Element | null {
  return container.querySelector("h3")?.parentElement?.previousElementSibling ?? null;
}

describe("TaskListCard left edge", () => {
  it("reserves the checkbox slot at the same size when the checkbox cannot render", () => {
    const { container: withCheckbox, unmount } = card({ status: "open", assigneeEmail: "alice@example.com", assignees: ["alice@example.com"] });
    const checkbox = screen.getByRole("checkbox", { name: "Mark complete" });
    expect(checkbox).toHaveClass("size-5", "shrink-0", "mt-0.5");
    expect(leftSlot(withCheckbox)).toBe(checkbox);
    unmount();

    const { container: withoutCheckbox } = card({ status: "open", assigneeEmail: "bob@example.com", assignees: ["bob@example.com"] });
    expect(screen.queryByRole("checkbox")).toBeNull();
    const placeholder = leftSlot(withoutCheckbox);
    expect(placeholder).toHaveAttribute("aria-hidden");
    expect(placeholder).toHaveClass("size-5", "shrink-0", "mt-0.5");
    expect(placeholder?.tagName).toBe("SPAN");
  });
});

describe("TaskListCard assignee", () => {
  it("shows the assignee chip, not a select, for a done task", () => {
    card({ status: "done" });
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
  });

  it("keeps the select interactive for a proposed task the viewer can triage", () => {
    card({ status: "proposed" });
    expect(screen.getByRole("combobox", { name: "Assignee" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("replaces the select with a chip for a proposed task the viewer cannot triage", () => {
    card({ status: "proposed" }, false);
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    // One chip in the metadata row, one standing in for the select: both
    // resolve the same address.
    expect(screen.getAllByTitle("alice@example.com")).toHaveLength(2);
  });
});

describe("TaskListCard visibility chip", () => {
  it("is absent for an all-hands task", () => {
    card({ status: "open", clearance: ["all-hands"] });
    expect(screen.queryByText("All-hands")).toBeNull();
    expect(screen.queryByText("Restricted")).toBeNull();
  });

  it("is present and names the group for a restricted task", () => {
    card({ status: "open", clearance: ["exec-team"] });
    expect(screen.getByText("Exec Team")).toBeInTheDocument();
  });
});

describe("TaskListCard description", () => {
  it("clamps to two lines", () => {
    const { container } = card({ status: "open" });
    expect(container.querySelector("p.line-clamp-2")).toBeInTheDocument();
  });
});

// `move` into done already accepted in_progress, so hiding the checkbox there
// let the board finish a task the list said could not be finished.
describe("TaskListCard completing in progress work", () => {
  it("offers the checkbox on an in progress task the viewer owns", () => {
    card({ status: "in_progress" });
    expect(screen.getByRole("checkbox", { name: "Mark complete" })).toBeInTheDocument();
  });

  it("completes it", async () => {
    const user = userEvent.setup();
    card({ status: "in_progress" });
    await user.click(screen.getByRole("checkbox", { name: "Mark complete" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "complete" }),
    }));
  });

  it("withholds it on somebody else's in progress task", () => {
    card({ status: "in_progress", assigneeEmail: "bob@example.com", assignees: ["bob@example.com"] });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

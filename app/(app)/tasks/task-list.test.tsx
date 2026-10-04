// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { TaskList } from "./task-list";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn(async () => Response.json({ ok: true }));

function task(id: string, status: TaskStatus): TaskRecord {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    assigneeEmail: "alice@example.com",
    assignees: ["alice@example.com"],
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["all-hands"],
    status,
    due: null,
    origin: "manual",
    projectId: null,
    createdBy: "alice@example.com",
    createdAt: "2026-07-23T12:00:00Z",
  };
}

function list(tasks: TaskRecord[]) {
  return render(
    <TaskList
      tasks={tasks}
      members={["alice@example.com"]}
      people={{}}
      actorEmail="alice@example.com"
      viewerClearance={["all-hands"]}
      canTriage
    />,
  );
}

/** The card's own status badge also reads "Done", so the section header is
 * found through the <summary> element rather than by its text. */
function doneSummary() {
  const summary = document.querySelector("summary");
  if (!summary) throw new Error("no Done summary in the document");
  return summary;
}

beforeEach(() => {
  refresh.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TaskList sections", () => {
  it("splits tasks into To do, In progress and Done, each with its own count", () => {
    list([task("t1", "open"), task("t2", "in_progress"), task("t3", "done")]);
    expect(screen.getByRole("heading", { name: "To do1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In progress1" })).toBeInTheDocument();
    expect(doneSummary()).toHaveTextContent("Done1");
    expect(screen.getByText("Task t1")).toBeInTheDocument();
    expect(screen.getByText("Task t2")).toBeInTheDocument();
  });

  it("renders no header for a section with no tasks", () => {
    list([task("t1", "open")]);
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("shows one message when there are no tasks at all", () => {
    list([]);
    expect(screen.getByText("No tasks in this view.")).toBeInTheDocument();
    expect(screen.queryByText("To do")).not.toBeInTheDocument();
  });

  it("keeps Done closed by default, revealing its cards only once opened", async () => {
    const user = userEvent.setup();
    list([task("t1", "done")]);
    expect(screen.getByText("Task t1")).not.toBeVisible();
    await user.click(doneSummary());
    expect(screen.getByText("Task t1")).toBeVisible();
  });
});

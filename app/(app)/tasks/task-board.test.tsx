// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { TaskBoard } from "./task-board";

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

/** jsdom has no DataTransfer, and the drop path is exactly what it carries. */
function dataTransfer() {
  const store = new Map<string, string>();
  return {
    dropEffect: "",
    effectAllowed: "",
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  };
}

function board(tasks: TaskRecord[] = [task("t1", "open"), task("t2", "done"), task("t3", "in_progress")]) {
  return render(
    <TaskBoard
      tasks={tasks}
      members={["alice@example.com"]}
      people={{}}
      canTriage
    />,
  );
}

function column(label: string) {
  return screen.getByRole("region", { name: label });
}

function cardIn(label: string) {
  return within(column(label)).getAllByRole("listitem")[0];
}

beforeEach(() => {
  refresh.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TaskBoard drag and drop", () => {
  it("puts the task id on the drag, so the browser does not refuse the drop", () => {
    board();
    const transfer = dataTransfer();
    fireEvent.dragStart(cardIn("To do"), { dataTransfer: transfer });
    expect(transfer.getData("text/plain")).toBe("t1");
    expect(transfer.effectAllowed).toBe("move");
  });

  it("cancels dragenter and dragover, which is what makes a column droppable", () => {
    board();
    const transfer = dataTransfer();
    // fireEvent returns false when the handler called preventDefault. The spec
    // needs BOTH cancelled: cancelling dragover alone leaves the drop refused.
    expect(fireEvent.dragEnter(column("In progress"), { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.dragOver(column("In progress"), { dataTransfer: transfer })).toBe(false);
    expect(transfer.dropEffect).toBe("move");
  });

  it("moves the dropped task into the column it landed in", async () => {
    board();
    const transfer = dataTransfer();
    fireEvent.dragStart(cardIn("To do"), { dataTransfer: transfer });
    fireEvent.drop(column("Done"), { dataTransfer: transfer });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/t1");
    expect(JSON.parse(String(init.body))).toEqual({ action: "move", status: "done" });
  });

  it("reads the id back off the drag when the drop lands without board state", () => {
    board();
    const transfer = dataTransfer();
    transfer.setData("text/plain", "t1");
    fireEvent.drop(column("Done"), { dataTransfer: transfer });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("takes the cards out of hit testing mid-drag, so the drop reaches the column", () => {
    board();
    const transfer = dataTransfer();
    const card = cardIn("To do");
    // Chrome refuses a drop that lands on a form control, and every card holds
    // an assignee select. Without this the drop silently does nothing.
    expect(card.className).not.toContain("pointer-events-none");
    fireEvent.dragStart(card, { dataTransfer: transfer });
    expect(cardIn("In progress").className).toContain("pointer-events-none");
    fireEvent.dragEnd(cardIn("To do"), { dataTransfer: transfer });
    expect(cardIn("In progress").className).not.toContain("pointer-events-none");
  });

  it("says why a refused drop did nothing, the feedback the move buttons used to give", async () => {
    // The shape `fail()` actually sends, per app/api/tasks/[id]/route.test.ts.
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "not_assignee" } }, { status: 403 }));
    board();
    const transfer = dataTransfer();
    fireEvent.dragStart(cardIn("To do"), { dataTransfer: transfer });
    fireEvent.drop(column("Done"), { dataTransfer: transfer });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the person this is assigned to can complete it.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("TaskBoard columns", () => {
  it("renders three columns and no Inbox", () => {
    board();
    expect(screen.getByRole("region", { name: "To do" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument();
  });

  it("counts tasks directly off the tasks prop, with no scoping of its own", () => {
    board([task("t1", "open"), task("t2", "open"), task("t3", "done")]);
    expect(within(column("To do")).getByText("2")).toBeInTheDocument();
    expect(within(column("Done")).getByText("1")).toBeInTheDocument();
  });
});

describe("TaskBoard Done collapse", () => {
  // An empty Done column offers nothing to expand, but it stays a drop target.
  it("skips the disclosure when nothing is done yet", () => {
    board([task("t1", "open")]);
    expect(column("Done").querySelector("details")).toBeNull();
    expect(within(column("Done")).getByText("Empty")).toBeInTheDocument();
  });

  it("keeps Done cards out of view until the details is opened", () => {
    board([task("t1", "open"), task("t2", "done")]);
    expect(screen.getByText("Task t2")).not.toBeVisible();
    const details = column("Done").querySelector("details") as HTMLDetailsElement;
    details.open = true;
    expect(screen.getByText("Task t2")).toBeVisible();
  });

  it("completes a drop onto a collapsed Done column", () => {
    board([task("t1", "open"), task("t2", "done")]);
    const details = column("Done").querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const transfer = dataTransfer();
    fireEvent.dragStart(cardIn("To do"), { dataTransfer: transfer });
    fireEvent.drop(column("Done"), { dataTransfer: transfer });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/t1");
    expect(JSON.parse(String(init.body))).toEqual({ action: "move", status: "done" });
  });
});

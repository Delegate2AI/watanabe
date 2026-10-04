// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { TasksSurface } from "./tasks-surface";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

function task(id: string, status: TaskStatus, assigneeEmail: string | null = "alice@example.com"): TaskRecord {
  return {
    id,
    title: `Task ${id}`,
    description: `Description ${id}`,
    assigneeEmail,
    assignees: assigneeEmail ? [assigneeEmail] : [],
    sourceMeetingId: "circleback:m1",
    sourceNotePath: "docs/meetings/m1.md",
    clearance: ["all-hands"],
    sourceAttendees: [],
    status,
    due: null,
    origin: "circleback",
    projectId: null,
    createdBy: null,
    createdAt: "2026-07-23T12:00:00Z",
  };
}

function surface(tasks: TaskRecord[], overrides: Record<string, unknown> = {}) {
  return render(
    <TasksSurface
      tasks={tasks}
      members={["alice@example.com", "bob@example.com"]}
      people={{}}
      myGroups={["all-hands"]}
      viewerClearance={["all-hands"]}
      actorEmail="alice@example.com"
      canTriage
      {...overrides}
    />,
  );
}

/**
 * The strip is closed by default, so every triage assertion opens it first.
 * Matched on the whole phrase: an unassigned `AssigneeChip` also reads "Needs
 * triage", and every card in the strip carries one.
 */
const INBOX_SUMMARY = /(item needs|items need) triage/;

async function openInbox(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText(INBOX_SUMMARY).closest("summary")!);
}

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
});

describe("TasksSurface scope", () => {
  it("defaults to Mine in the list layout", () => {
    surface([task("mine", "open"), task("theirs", "open", "bob@example.com")]);
    expect(screen.getByRole("tab", { name: "Mine 1", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Task mine")).toBeInTheDocument();
    expect(screen.queryByText("Task theirs")).not.toBeInTheDocument();
  });

  it("shows the whole team's work under Team", async () => {
    const user = userEvent.setup();
    surface([task("mine", "open"), task("theirs", "open", "bob@example.com")]);
    await user.click(screen.getByRole("tab", { name: "Team 2" }));
    expect(screen.getByText("Task mine")).toBeInTheDocument();
    expect(screen.getByText("Task theirs")).toBeInTheDocument();
  });

  // Every count names exactly one visible group: proposed belongs to the strip
  // and done is folded away, so neither inflates a scope count.
  it("counts only open and in progress work", () => {
    surface([
      task("open", "open"),
      task("running", "in_progress"),
      task("finished", "done"),
      task("waiting", "proposed", null),
    ]);
    expect(screen.getByRole("tab", { name: "Mine 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Team 2" })).toBeInTheDocument();
  });

  it("hides the Unassigned segment while nothing is unassigned", () => {
    surface([task("mine", "open"), task("waiting", "proposed", null)]);
    expect(screen.queryByRole("tab", { name: /Unassigned/ })).not.toBeInTheDocument();
  });

  it("offers Unassigned once an accepted task has no assignee", () => {
    surface([task("mine", "open"), task("orphan", "open", null)]);
    expect(screen.getByRole("tab", { name: "Unassigned 1" })).toBeInTheDocument();
  });

  it("keeps the scope when the layout changes", async () => {
    const user = userEvent.setup();
    surface([task("mine", "open"), task("theirs", "open", "bob@example.com")]);
    await user.click(screen.getByRole("tab", { name: "Team 2" }));
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("tab", { name: "Team 2", selected: true })).toBeInTheDocument();
    expect(screen.getByText("Task theirs")).toBeInTheDocument();
  });

  it("narrows Team by group and keeps the Team segment selected", async () => {
    const user = userEvent.setup();
    const product = { ...task("product", "open", "bob@example.com"), clearance: ["product"] };
    surface([task("mine", "open"), product], { myGroups: ["all-hands", "product"] });
    await user.click(screen.getByRole("tab", { name: "Team 2" }));
    await user.selectOptions(screen.getByLabelText("Group"), "group:product");
    // The count narrows with the filter, or it names a different set than the
    // cards under it.
    expect(screen.getByRole("tab", { name: "Team 1", selected: true })).toBeInTheDocument();
    expect(screen.getByText("Task product")).toBeInTheDocument();
    expect(screen.queryByText("Task mine")).not.toBeInTheDocument();
  });
});

describe("TasksSurface triage strip", () => {
  // The board used to open scoped to the viewer's own tasks, and a proposed
  // task is assigned to nobody, so the queue was invisible by default.
  it("surfaces proposed tasks whatever the scope is", async () => {
    const user = userEvent.setup();
    surface([task("waiting", "proposed", null)]);
    expect(screen.getByText(/1 item needs triage/)).toBeInTheDocument();
    await openInbox(user);
    expect(screen.getByText("Task waiting")).toBeVisible();
  });

  // The badge counts proposals assigned to the viewer or to nobody, so a
  // proposal already routed to a teammate must not inflate the strip past it.
  it("leaves a proposal routed to somebody else out of the strip", () => {
    surface([task("theirs", "proposed", "bob@example.com"), task("waiting", "proposed", null)]);
    expect(screen.getByText(/1 item needs triage/)).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to triage", () => {
    surface([task("mine", "open")]);
    expect(screen.queryByText(INBOX_SUMMARY)).not.toBeInTheDocument();
  });

  it("keeps proposed tasks out of both layouts", async () => {
    const user = userEvent.setup();
    surface([task("waiting", "proposed", null)]);
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(within(screen.getByRole("region", { name: "To do" })).queryByText("Task waiting")).toBeNull();
  });

  it("accepts a proposed task with the selected assignee", async () => {
    const user = userEvent.setup();
    surface([task("inbox", "proposed", null)]);
    await openInbox(user);
    const card = screen.getByText("Task inbox").closest("article")!;
    await user.selectOptions(within(card).getByLabelText("Assignee"), "bob@example.com");
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/inbox", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "accept", assignees: ["bob@example.com"] }),
    }));
  });

  it("accepts a proposed task with several assignees", async () => {
    const user = userEvent.setup();
    surface([task("inbox", "proposed", null)]);
    await openInbox(user);
    const card = screen.getByText("Task inbox").closest("article")!;
    await user.selectOptions(within(card).getByLabelText("Assignee"), "bob@example.com");
    await user.selectOptions(within(card).getByLabelText("Assignee"), "alice@example.com");
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/inbox", expect.objectContaining({
      body: JSON.stringify({ action: "accept", assignees: ["bob@example.com", "alice@example.com"] }),
    }));
  });

  it("drops an assignee the triager removes before accepting", async () => {
    const user = userEvent.setup();
    surface([task("inbox", "proposed", null)]);
    await openInbox(user);
    const card = screen.getByText("Task inbox").closest("article")!;
    await user.selectOptions(within(card).getByLabelText("Assignee"), "bob@example.com");
    await user.click(within(card).getByRole("button", { name: "Remove bob@example.com" }));
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/inbox", expect.objectContaining({
      body: JSON.stringify({ action: "accept" }),
    }));
  });

  it("accepts a proposed task without an assignee", async () => {
    const user = userEvent.setup();
    surface([task("inbox", "proposed", null)]);
    await openInbox(user);
    const card = screen.getByText("Task inbox").closest("article")!;
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/inbox", expect.objectContaining({
      body: JSON.stringify({ action: "accept" }),
    }));
  });
});

describe("TasksSurface source meeting link", () => {
  // A task reaches its meeting's attendees whatever its clearance says, but the
  // note behind it does not: the KB is served from a clearance-filtered
  // projection, so for them that link would lead to a 404.
  it("hides the link from a viewer the task's clearance does not cover", async () => {
    const user = userEvent.setup();
    const restricted = { ...task("attended", "proposed", null), clearance: ["admins"] };
    surface([restricted], { actorEmail: "dana@example.com" });
    await openInbox(user);
    expect(screen.getByText("Task attended")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Source meeting" })).not.toBeInTheDocument();
  });

  it("keeps the link for a viewer the clearance does cover", async () => {
    const user = userEvent.setup();
    surface([task("covered", "proposed", null)]);
    await openInbox(user);
    expect(screen.getByRole("link", { name: "Source meeting" })).toHaveAttribute("href", "/kb/meetings/m1");
  });
});

describe("TasksSurface task links", () => {
  it("links titles to task detail from either layout", async () => {
    const user = userEvent.setup();
    surface([task("linked", "open")]);
    expect(screen.getByRole("link", { name: "Task linked" })).toHaveAttribute("href", "/tasks/linked");
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("link", { name: "Task linked" })).toHaveAttribute("href", "/tasks/linked");
  });
});

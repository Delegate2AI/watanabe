// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TaskRecord } from "@/lib/db/tasks";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentityMock() }));
let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});
vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => ({ exec: ["alice@example.com", "bob@example.com"] }),
  allMembers: () => ["alice@example.com", "bob@example.com"],
  assignableMembers: () => ["alice@example.com", "bob@example.com"],
}));

const getVisibleTaskMock = vi.fn();
vi.mock("@/lib/db/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/tasks")>();
  return { ...actual, getVisibleTask: (...args: unknown[]) => getVisibleTaskMock(...args) };
});

const getProjectMock = vi.fn();
vi.mock("@/lib/db/projects", () => ({
  getProjectForRequester: (...args: unknown[]) => getProjectMock(...args),
}));

const task: TaskRecord = {
  id: "t1",
  title: "Publish the full summary",
  description: "A complete description that must not be truncated on the detail page.",
  assigneeEmail: "alice@example.com",
  assignees: ["alice@example.com"],
  sourceMeetingId: "circleback:m1",
  sourceNotePath: "docs/meetings/2026/review.md",
  clearance: ["exec"],
  sourceAttendees: [],
  status: "open",
  due: "2026-07-30",
  origin: "manual",
  projectId: "p1",
  createdBy: "alice@example.com",
  createdAt: "2026-07-23T12:00:00Z",
};

const Page = (await import("./page")).default;
const { openDb } = await import("@/lib/db/client");
const { insertProposed } = await import("@/lib/db/tasks");
const { addComment } = await import("@/lib/db/task-comments");
const call = (id: string) => Page({ params: Promise.resolve({ id }) });

beforeEach(() => {
  db = openDb(":memory:");
  // getVisibleTask is mocked below, so this row exists only to satisfy the
  // task_comments foreign key: listComments/addComment hit the real db.
  insertProposed(db, {
    id: "t1", title: task.title, description: task.description, assigneeEmail: task.assigneeEmail,
    sourceMeetingId: task.sourceMeetingId, sourceNotePath: task.sourceNotePath, clearance: task.clearance,
    due: task.due, origin: task.origin, createdAt: task.createdAt,
  });
  process.env.TASKS_ENABLED = "1";
  delete process.env.ROLES_ENABLED;
  notFoundMock.mockClear();
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "alice@example.com", clearance: ["all-hands", "exec"] });
  getVisibleTaskMock.mockReset().mockReturnValue(task);
  getProjectMock.mockReset().mockReturnValue({ id: "p1", name: "Q3 launch" });
});

afterEach(() => {
  delete process.env.TASK_COMMENTS_ENABLED;
});

describe("TaskDetailPage", () => {
  it("renders full task metadata, links, and legal creator actions", async () => {
    const page = await call("t1");
    // The due label is relative, so the clock is pinned to a local time: only a
    // local pin makes a calendar-day delta the same in every timezone.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00"));
    try {
      render(page);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByRole("heading", { name: task.title })).toBeInTheDocument();
    expect(screen.getByText(task.description)).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("exec")).toBeInTheDocument();
    expect(screen.getAllByText("alice@example.com").length).toBeGreaterThan(0);
    expect(screen.getByTitle("30 Jul 2026")).toHaveAttribute("datetime", "2026-07-30");
    expect(screen.getByRole("link", { name: "Source meeting" })).toHaveAttribute("href", "/kb/meetings/2026/review");
    expect(screen.getByRole("link", { name: "Q3 launch" })).toHaveAttribute("href", "/projects/p1");
    expect(screen.getByRole("button", { name: "Complete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders the assignee's resolved display name in the Assignee row", async () => {
    getVisibleTaskMock.mockReturnValue({ ...task, assigneeEmail: "priya.nair@example.com" });
    render(await call("t1"));
    const assigneeRow = screen.getByText("Assignee").closest("div");
    expect(assigneeRow).not.toBeNull();
    expect(assigneeRow as HTMLElement).toHaveTextContent("priya.nair@example.com");
  });

  it("hides Delete from the assignee when someone else created the task", async () => {
    getVisibleTaskMock.mockReturnValue({ ...task, createdBy: "devon@example.com" });
    render(await call("t1"));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("hides Delete when the task records no creator", async () => {
    getVisibleTaskMock.mockReturnValue({ ...task, createdBy: null });
    render(await call("t1"));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offers Dismiss for a proposed task", async () => {
    getVisibleTaskMock.mockReturnValue({ ...task, status: "proposed", origin: "circleback", assigneeEmail: null });
    render(await call("t1"));
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("404s unknown and uncleared tasks identically", async () => {
    getVisibleTaskMock.mockReturnValue(null);
    await expect(call("unknown")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(call("uncleared")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it("renders the discussion panel with the existing comments when the flag is on", async () => {
    process.env.TASK_COMMENTS_ENABLED = "1";
    addComment(db, {
      id: "c1", taskId: "t1", authorEmail: "alice@example.com",
      body: "first thought", createdAt: "2026-08-07T00:01:00.000Z",
    });

    render(await call("t1"));
    expect(screen.getByText("Discussion")).toBeTruthy();
    expect(screen.getByText("first thought")).toBeTruthy();
  });

  it("renders no discussion panel when the flag is off", async () => {
    delete process.env.TASK_COMMENTS_ENABLED;
    render(await call("t1"));
    expect(screen.queryByText("Discussion")).toBeNull();
  });
});

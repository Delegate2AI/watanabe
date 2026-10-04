// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListChecks } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";

const isTasksEnabledMock = vi.fn();
const isTaskCommentsEnabledMock = vi.fn();
vi.mock("@/lib/tasks/config", () => ({
  isTasksEnabled: () => isTasksEnabledMock(),
  isTaskCommentsEnabled: () => isTaskCommentsEnabledMock(),
}));
const countsForTasksMock = vi.fn(() => ({}));
vi.mock("@/lib/db/task-comments", () => ({
  countsForTasks: (...args: unknown[]) => countsForTasksMock(...(args as [])),
}));

const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentityMock() }));
const getForRequesterMock = vi.fn(() => []);
const getBoardTasksMock = vi.fn(() => []);
vi.mock("@/lib/db/tasks", () => ({
  getForRequester: (...args: unknown[]) => getForRequesterMock(...(args as [])),
  getBoardTasks: (...args: unknown[]) => getBoardTasksMock(...(args as [])),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
// The real one reads access/aliases.yaml off disk. Stubbing the registry keeps
// the canonicalization step itself under test without a fixture file.
vi.mock("@/lib/db/tasks-visibility", () => ({
  requesterKey: (email: string) =>
    email === "alice.personal@example.com" ? "alice@example.com" : email.trim().toLowerCase(),
}));
vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => ({ "all-hands": ["alice@example.com", "bob@example.com"] }),
  allMembers: () => ["alice@example.com", "bob@example.com"],
  assignableMembers: () => ["alice@example.com", "bob@example.com"],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const Page = (await import("./page")).default;

beforeEach(() => {
  isTasksEnabledMock.mockReset();
  isTaskCommentsEnabledMock.mockReset();
  countsForTasksMock.mockClear();
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "alice@example.com", clearance: ["all-hands"] });
  getForRequesterMock.mockClear();
  getBoardTasksMock.mockClear();
});

describe("TasksPage", () => {
  it("renders the byte-identical spec-21 RouteScaffold when the flag is off", async () => {
    isTasksEnabledMock.mockReturnValue(false);
    const element = await Page();
    const actual = renderToStaticMarkup(element);
    const expected = renderToStaticMarkup(
      <RouteScaffold
        icon={ListChecks}
        eyebrow="Tasks"
        title="From your meetings"
        description="Action items Watanabe pulled from meetings you attended or are cleared for. Proposed items wait for you to accept before they count."
        spec="spec 21"
        flag="TASKS_ENABLED"
      />,
    );
    expect(actual).toBe(expected);
    expect(resolveIdentityMock).not.toHaveBeenCalled();
    expect(getForRequesterMock).not.toHaveBeenCalled();
    expect(getBoardTasksMock).not.toHaveBeenCalled();
  });

  // `boardVisibleWhere()` is `clearanceWhere()` and `visibleWhere()` is that
  // plus the assignee half, so the board set is a strict superset and the Mine
  // and Unassigned scopes are filters over it, not a second query.
  it("reads one task set scoped to the viewer clearance", async () => {
    isTasksEnabledMock.mockReturnValue(true);
    await Page();
    expect(getBoardTasksMock).toHaveBeenCalledWith({}, "alice@example.com", ["all-hands"]);
    expect(getForRequesterMock).not.toHaveBeenCalled();
  });

  it("shows Mine and a New task control by default when enabled", async () => {
    isTasksEnabledMock.mockReturnValue(true);
    const element = await Page();
    const { getByRole } = render(element);
    expect(getByRole("tab", { name: "Mine 0", selected: true })).toBeInTheDocument();
    expect(getByRole("button", { name: /New task/ })).toBeInTheDocument();
  });

  // Assignees are stored canonical. Handing the client the raw session address
  // left an alias-authenticated viewer's own tasks in neither Mine (the two
  // addresses differ) nor Unassigned (the task has an assignee), so they
  // dropped out of every scope.
  it("matches Mine on the canonical address when the session uses an alias", async () => {
    isTasksEnabledMock.mockReturnValue(true);
    resolveIdentityMock.mockResolvedValue({ email: "alice.personal@example.com", clearance: ["all-hands"] });
    getBoardTasksMock.mockReturnValueOnce([
      {
        id: "hers",
        title: "Task hers",
        description: "",
        assigneeEmail: "alice@example.com",
        assignees: ["alice@example.com"],
        sourceMeetingId: null,
        sourceNotePath: null,
        clearance: ["all-hands"],
        sourceAttendees: [],
        status: "open",
        due: null,
        origin: "manual",
        projectId: null,
        createdBy: "alice@example.com",
        createdAt: "2026-08-20T12:00:00Z",
      },
    ]);
    const { getByRole, getByText } = render(await Page());
    expect(getByRole("tab", { name: "Mine 1", selected: true })).toBeInTheDocument();
    expect(getByText("Task hers")).toBeInTheDocument();
  });

  it("skips the comment count query when the comments flag is off", async () => {
    isTasksEnabledMock.mockReturnValue(true);
    isTaskCommentsEnabledMock.mockReturnValue(false);
    await Page();
    expect(countsForTasksMock).not.toHaveBeenCalled();
  });

  it("runs one comment count query over every task id when the flag is on", async () => {
    isTasksEnabledMock.mockReturnValue(true);
    isTaskCommentsEnabledMock.mockReturnValue(true);
    await Page();
    expect(countsForTasksMock).toHaveBeenCalledOnce();
    expect(countsForTasksMock).toHaveBeenCalledWith({}, []);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { TriageStrip } from "./triage-strip";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn(async () => Response.json({ ok: true }));

function task(id: string, status: TaskStatus = "proposed"): TaskRecord {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    assigneeEmail: null,
    assignees: [],
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

function strip(overrides: Partial<Parameters<typeof TriageStrip>[0]> = {}) {
  return render(
    <TriageStrip
      tasks={[task("t1")]}
      members={["alice@example.com"]}
      people={{}}
      actorEmail="alice@example.com"
      viewerClearance={["all-hands"]}
      canTriage
      {...overrides}
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

describe("TriageStrip", () => {
  it("renders nothing when there is nothing to triage", () => {
    const { container } = strip({ tasks: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("collapses by default and names the count", () => {
    strip({ tasks: [task("t1"), task("t2")] });
    expect(screen.getByText("Inbox")).toBeVisible();
    expect(screen.getByText("2 items need triage")).toBeVisible();
    expect(screen.getByText("Task t1")).not.toBeVisible();
  });

  it("uses the singular for one item", () => {
    strip({ tasks: [task("t1")] });
    expect(screen.getByText("1 item needs triage")).toBeVisible();
  });

  it("opens to show a card per task", async () => {
    const user = userEvent.setup();
    strip({ tasks: [task("t1"), task("t2")] });
    await user.click(screen.getByText("Inbox"));
    expect(screen.getByText("Task t1")).toBeVisible();
    expect(screen.getByText("Task t2")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("passes the resolved comment count down to the card", async () => {
    const user = userEvent.setup();
    strip({ tasks: [task("t1")], commentCounts: { t1: 3 } });
    await user.click(screen.getByText("Inbox"));
    expect(screen.getByLabelText("3 comments")).toBeVisible();
  });

  it("defaults an unlisted task's comment count to 0", async () => {
    const user = userEvent.setup();
    strip({ tasks: [task("t1")], commentCounts: {} });
    await user.click(screen.getByText("Inbox"));
    expect(screen.queryByLabelText(/comments?/)).not.toBeInTheDocument();
  });

  it("disables triage actions when canTriage is false", async () => {
    const user = userEvent.setup();
    strip({ canTriage: false });
    await user.click(screen.getByText("Inbox"));
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  });
});

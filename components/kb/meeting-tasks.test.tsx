// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeetingTasks, type MeetingTaskItem } from "./meeting-tasks";

const TASKS: MeetingTaskItem[] = [
  { id: "task-a", title: "Publish the summary", status: "open", assigneeEmail: "alice@example.com" },
  { id: "task-b", title: "Book the venue", status: "proposed", assigneeEmail: null },
];

describe("MeetingTasks", () => {
  it("renders nothing for a note with no tasks, so a non-meeting note is unchanged", () => {
    const { container } = render(<MeetingTasks tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each task to its detail page, where acting on it lives", () => {
    render(<MeetingTasks tasks={TASKS} />);

    expect(screen.getByRole("link", { name: "Publish the summary" })).toHaveAttribute(
      "href",
      "/tasks/task-a",
    );
    expect(screen.getByRole("link", { name: "Book the venue" })).toHaveAttribute(
      "href",
      "/tasks/task-b",
    );
  });

  it("shows the live status and the assignee, or names the gap", () => {
    render(<MeetingTasks tasks={TASKS} />);

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});

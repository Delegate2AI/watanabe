// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTaskDialog } from "./new-task-dialog";
import type { Person } from "@/lib/people/types";

// The assignee select renders people by name, so the directory has to be here.
const PEOPLE: Record<string, Person> = {
  "alice@example.com": { email: "alice@example.com", name: "Alice Ng", initials: "AN", isSelf: false },
  "bob@example.com": { email: "bob@example.com", name: "Bob Ito", initials: "BI", isSelf: false },
};

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ task: { id: "x" } }) })));
});

describe("NewTaskDialog", () => {
  it("opens the form, posts the task, and refreshes", async () => {
    const user = userEvent.setup();
    render(<NewTaskDialog members={["alice@example.com", "bob@example.com"]} people={PEOPLE} myGroups={["engineering"]} />);

    await user.click(screen.getByRole("button", { name: /New task/ }));
    await user.type(screen.getByLabelText(/Title/), "Draft the roadmap");
    await user.selectOptions(screen.getByLabelText(/Assignee/), "bob@example.com");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Draft the roadmap", description: "", assignees: ["bob@example.com"], clearance: "engineering" }),
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  // Every other task surface renders a person by name; this dialog listed raw
  // addresses, so it was the one place the people directory's promise broke.
  it("labels assignees by name, not by email address", async () => {
    const user = userEvent.setup();
    render(<NewTaskDialog members={["alice@example.com", "bob@example.com"]} people={PEOPLE} myGroups={["engineering"]} />);

    await user.click(screen.getByRole("button", { name: /New task/ }));
    const assignee = screen.getByLabelText(/Assignee/);
    expect(assignee).toHaveTextContent("Alice Ng");
    expect(assignee).toHaveTextContent("Bob Ito");
    expect(assignee).not.toHaveTextContent("alice@example.com");
  });

  it("blocks submission with a blank title and does not post", async () => {
    const user = userEvent.setup();
    render(<NewTaskDialog members={["alice@example.com"]} people={PEOPLE} myGroups={["engineering"]} />);
    await user.click(screen.getByRole("button", { name: /New task/ }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Title is required/);
  });

  it("opens as a modal dialog and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<NewTaskDialog members={["alice@example.com"]} people={PEOPLE} myGroups={["engineering"]} />);
    await user.click(screen.getByRole("button", { name: /New task/ }));
    expect(screen.getByRole("dialog", { name: "New task" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the backdrop scrim is clicked", async () => {
    const user = userEvent.setup();
    render(<NewTaskDialog members={["alice@example.com"]} people={PEOPLE} myGroups={["engineering"]} />);
    await user.click(screen.getByRole("button", { name: /New task/ }));
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskScopeBar } from "./task-scope-bar";

function bar(overrides: Partial<Parameters<typeof TaskScopeBar>[0]> = {}) {
  const onScope = vi.fn();
  const onLayout = vi.fn();
  render(
    <TaskScopeBar
      scope="mine"
      onScope={onScope}
      layout="list"
      onLayout={onLayout}
      counts={{ mine: 6, unassigned: 2, team: 19 }}
      myGroups={["all-hands", "product"]}
      {...overrides}
    />,
  );
  return { onScope, onLayout };
}

describe("TaskScopeBar scope segments", () => {
  it("names each segment with its label and count", () => {
    bar();
    expect(screen.getByRole("tablist", { name: "Task scope" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mine 6" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Unassigned 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Team 19" })).toBeInTheDocument();
  });

  it("marks the current scope selected", () => {
    bar({ scope: "team" });
    expect(screen.getByRole("tab", { name: "Mine 6" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Team 19" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps Team selected under a group filter", () => {
    bar({ scope: "group:product" });
    expect(screen.getByRole("tab", { name: "Team 19" })).toHaveAttribute("aria-selected", "true");
  });

  it("reports the clicked segment", async () => {
    const user = userEvent.setup();
    const { onScope } = bar();
    await user.click(screen.getByRole("tab", { name: "Team 19" }));
    expect(onScope).toHaveBeenCalledWith("team");
  });

  it("hides Unassigned when its count is 0", () => {
    bar({ counts: { mine: 6, unassigned: 0, team: 19 } });
    expect(screen.queryByRole("tab", { name: /Unassigned/ })).not.toBeInTheDocument();
  });

  it("still shows Unassigned at 0 when it is the current scope", () => {
    bar({ scope: "unassigned", counts: { mine: 6, unassigned: 0, team: 19 } });
    expect(screen.getByRole("tab", { name: "Unassigned 0" })).toBeInTheDocument();
  });
});

describe("TaskScopeBar group select", () => {
  it("is absent outside Team scope", () => {
    bar({ scope: "mine" });
    expect(screen.queryByLabelText("Group")).not.toBeInTheDocument();
  });

  it("is absent when the viewer has no groups", () => {
    bar({ scope: "team", myGroups: [] });
    expect(screen.queryByLabelText("Group")).not.toBeInTheDocument();
  });

  it("offers All groups plus one option per group, labelled", async () => {
    bar({ scope: "team" });
    const select = screen.getByLabelText("Group");
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "All groups" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All Hands" })).toBeInTheDocument();
  });

  it("reflects a group scope as its value", () => {
    bar({ scope: "group:product" });
    expect(screen.getByLabelText("Group")).toHaveValue("group:product");
  });

  it("reports team scope when All groups is chosen", async () => {
    const user = userEvent.setup();
    const { onScope } = bar({ scope: "group:product" });
    await user.selectOptions(screen.getByLabelText("Group"), "");
    expect(onScope).toHaveBeenCalledWith("team");
  });

  it("reports the group scope when a group is chosen", async () => {
    const user = userEvent.setup();
    const { onScope } = bar({ scope: "team" });
    await user.selectOptions(screen.getByLabelText("Group"), "group:product");
    expect(onScope).toHaveBeenCalledWith("group:product");
  });
});

describe("TaskScopeBar layout toggle", () => {
  it("is a pressed-state group, not tabs", () => {
    bar();
    const group = screen.getByRole("group", { name: "Layout" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the clicked layout", async () => {
    const user = userEvent.setup();
    const { onLayout } = bar();
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(onLayout).toHaveBeenCalledWith("board");
  });
});

describe("TaskScopeBar action slot", () => {
  it("renders the action on the right", () => {
    bar({ action: <button type="button">New task</button> });
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
  });
});

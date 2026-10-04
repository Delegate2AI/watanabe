// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectList } from "./project-list";
import type { ProjectCardData } from "./project-card";

afterEach(cleanup);

const PROJECTS: ProjectCardData[] = [
  { id: "p1", name: "Launch plan", clearance: ["all-hands"], threadCount: 2, taskCount: 1, lastActivity: "2026-07-20T00:00:00Z" },
  { id: "p2", name: "Pricing review", clearance: ["exec"], threadCount: 0, taskCount: 0, lastActivity: "2026-07-19T00:00:00Z" },
];

describe("ProjectList filter", () => {
  it("shows everything before anything is typed", () => {
    render(<ProjectList projects={PROJECTS} />);
    expect(screen.getByText("Launch plan")).toBeTruthy();
    expect(screen.getByText("Pricing review")).toBeTruthy();
  });

  it("narrows to matching projects, case-insensitively", async () => {
    render(<ProjectList projects={PROJECTS} />);
    await userEvent.type(screen.getByLabelText("Filter projects"), "PRICING");
    expect(screen.queryByText("Launch plan")).toBeNull();
    expect(screen.getByText("Pricing review")).toBeTruthy();
  });

  it("matches on the clearing group as well as the name", async () => {
    render(<ProjectList projects={PROJECTS} />);
    await userEvent.type(screen.getByLabelText("Filter projects"), "exec");
    expect(screen.getByText("Pricing review")).toBeTruthy();
    expect(screen.queryByText("Launch plan")).toBeNull();
  });

  it("says so when the filter hides everything", async () => {
    render(<ProjectList projects={PROJECTS} />);
    await userEvent.type(screen.getByLabelText("Filter projects"), "zzz");
    expect(screen.getByText("No projects match that filter.")).toBeTruthy();
  });
});

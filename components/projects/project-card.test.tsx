// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectCard } from "./project-card";

const BASE = {
  id: "p1",
  name: "Q3 Launch Comms",
  clearance: ["all-hands"],
  threadCount: 3,
  taskCount: 2,
  lastActivity: "2026-07-05T00:00:00Z",
};

describe("ProjectCard", () => {
  it("links to the project detail and shows its name", () => {
    render(<ProjectCard {...BASE} />);
    const link = screen.getByRole("link", { name: /Q3 Launch Comms/i });
    expect(link).toHaveAttribute("href", "/projects/p1");
  });

  it("shows an all-hands visibility chip and both counts", () => {
    render(<ProjectCard {...BASE} />);
    expect(screen.getByText("All-hands")).toBeInTheDocument();
    expect(screen.getByText(/3 threads/i)).toBeInTheDocument();
    expect(screen.getByText(/2 tasks/i)).toBeInTheDocument();
  });

  it("shows a restricted chip with the group when the project is not all-hands", () => {
    render(<ProjectCard {...BASE} clearance={["exec"]} />);
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.queryByText("All-hands")).not.toBeInTheDocument();
  });

  it("uses singular labels for a count of one", () => {
    render(<ProjectCard {...BASE} threadCount={1} taskCount={1} />);
    expect(screen.getByText(/1 thread\b/i)).toBeInTheDocument();
    expect(screen.getByText(/1 task\b/i)).toBeInTheDocument();
  });
});

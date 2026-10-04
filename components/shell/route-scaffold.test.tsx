// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListChecks } from "lucide-react";
import { RouteScaffold } from "./route-scaffold";

describe("RouteScaffold", () => {
  it("renders the page header and a built-but-dormant note naming the flag", () => {
    const { container } = render(
      <RouteScaffold
        icon={ListChecks}
        eyebrow="Tasks"
        title="From your meetings"
        description="Action items."
        spec="spec 21"
        flag="TASKS_ENABLED"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "From your meetings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText(/not switched on here/i)).toBeInTheDocument();
    // The note is actionable: it names the exact flag and the owning spec.
    expect(container.textContent).toContain("TASKS_ENABLED=1");
    expect(container.textContent).toContain("spec 21");
  });
});

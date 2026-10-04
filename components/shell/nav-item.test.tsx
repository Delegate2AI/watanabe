// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Home } from "lucide-react";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

import { NavItem } from "./nav-item";

describe("NavItem", () => {
  beforeEach(() => {
    pathname.value = "/";
  });

  it("is active when the pathname matches its href exactly", () => {
    pathname.value = "/tasks";
    render(<NavItem href="/tasks" icon={Home} label="Tasks" />);
    const link = screen.getByRole("link", { name: /tasks/i });
    expect(link).toHaveAttribute("data-active", "true");
  });

  it("is inactive for a different route", () => {
    pathname.value = "/meetings";
    render(<NavItem href="/tasks" icon={Home} label="Tasks" />);
    expect(screen.getByRole("link", { name: /tasks/i })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("treats Home ('/') as active only on the exact root, not on subroutes", () => {
    pathname.value = "/kb";
    render(<NavItem href="/" icon={Home} label="Home" />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("is active on nested paths of a section", () => {
    pathname.value = "/kb/01-product/points";
    render(<NavItem href="/kb" icon={Home} label="Knowledge base" />);
    expect(
      screen.getByRole("link", { name: /knowledge base/i }),
    ).toHaveAttribute("data-active", "true");
  });

  it("renders a count badge when provided", () => {
    render(<NavItem href="/tasks" icon={Home} label="Tasks" count={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

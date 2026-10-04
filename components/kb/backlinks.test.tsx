// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Backlinks } from "./backlinks";

describe("Backlinks", () => {
  it("renders a linked list of referrers", () => {
    render(<Backlinks links={[{ route: "01-planning/roadmap", title: "Roadmap" }]} />);
    const link = screen.getByRole("link", { name: "Roadmap" });
    expect(link).toHaveAttribute("href", "/kb/01-planning/roadmap");
  });

  it("renders nothing when there are no backlinks", () => {
    const { container } = render(<Backlinks links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

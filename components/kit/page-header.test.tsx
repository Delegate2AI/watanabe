// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders eyebrow, title, and description", () => {
    render(
      <PageHeader
        eyebrow="Tasks"
        title="From your meetings"
        description="Action items Watanabe pulled from meetings."
      />,
    );
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "From your meetings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Action items Watanabe pulled from meetings."),
    ).toBeInTheDocument();
  });

  it("omits the description paragraph when none is given", () => {
    const { container } = render(
      <PageHeader eyebrow="KB" title="Knowledge base" />,
    );
    expect(container.querySelector("p")).toBeNull();
  });
});

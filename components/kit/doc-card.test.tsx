// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocCard } from "./doc-card";

describe("DocCard", () => {
  it("renders title and subtitle", () => {
    render(
      <DocCard
        title="Risk-disclosure section"
        subtitle="Document · v2 · Open in canvas"
      />,
    );
    expect(screen.getByText("Risk-disclosure section")).toBeInTheDocument();
    expect(
      screen.getByText("Document · v2 · Open in canvas"),
    ).toBeInTheDocument();
  });

  it("fires onClick as a button when no href", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DocCard title="Draft" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /draft/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders an anchor to href when given", () => {
    render(<DocCard title="One-pager" href="/artifacts/one-pager" />);
    expect(screen.getByRole("link", { name: /one-pager/i })).toHaveAttribute(
      "href",
      "/artifacts/one-pager",
    );
  });
});

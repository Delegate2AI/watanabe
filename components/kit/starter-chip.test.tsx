// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Search } from "lucide-react";
import { StarterChip } from "./starter-chip";

describe("StarterChip", () => {
  it("fires onClick when it has no href (button)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<StarterChip label="My tasks" icon={Search} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /my tasks/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders an anchor to href when given", () => {
    render(<StarterChip label="Find in the KB" href="/kb" />);
    const link = screen.getByRole("link", { name: "Find in the KB" });
    expect(link).toHaveAttribute("href", "/kb");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityWindowToggle } from "./activity-window-toggle";

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/people",
  useSearchParams: () => searchParams,
}));

beforeEach(() => {
  pushMock.mockReset();
  searchParams = new URLSearchParams();
});

describe("ActivityWindowToggle", () => {
  it("renders the three windows with the current one selected", () => {
    render(<ActivityWindowToggle value="30d" />);
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All time" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("pushes the chosen window so the server re-renders", async () => {
    render(<ActivityWindowToggle value="30d" />);
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(pushMock).toHaveBeenCalledWith("/people?window=7d");
  });

  it("pushes the all-time window", async () => {
    render(<ActivityWindowToggle value="7d" />);
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(pushMock).toHaveBeenCalledWith("/people?window=all");
  });

  it("keeps the other search params when the window changes", async () => {
    searchParams = new URLSearchParams("q=ken&window=30d");
    render(<ActivityWindowToggle value="30d" />);
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(pushMock).toHaveBeenCalledWith("/people?q=ken&window=all");
  });

  it("does not navigate when the current window is chosen again", async () => {
    render(<ActivityWindowToggle value="30d" />);
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

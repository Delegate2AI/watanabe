// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBox } from "./search-box";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  pushMock.mockReset();
});

describe("SearchBox", () => {
  it("navigates to the search results route on Enter", async () => {
    render(<SearchBox />);
    const input = screen.getByLabelText("Search the knowledge base");
    await userEvent.type(input, "tokenomics{Enter}");
    expect(pushMock).toHaveBeenCalledWith("/kb/search?q=tokenomics");
  });

  it("navigates when the Search button is clicked (a submit path that does not rely on Enter)", async () => {
    render(<SearchBox />);
    await userEvent.type(screen.getByLabelText("Search the knowledge base"), "collateral");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(pushMock).toHaveBeenCalledWith("/kb/search?q=collateral");
  });
});

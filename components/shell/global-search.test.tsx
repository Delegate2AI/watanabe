// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearch } from "./global-search";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  pushMock.mockReset();
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({
      groups: [
        { label: "Chats", items: [{ title: "Rebalance planning", href: "/chat/t1" }] },
        { label: "Knowledge base", items: [{ title: "Rebalance policy", href: "/kb/notes/rebalance", snippet: "the policy" }] },
      ],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("GlobalSearch", () => {
  it("opens the palette from the search button and shows grouped results", async () => {
    render(<GlobalSearch />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByLabelText("Search everything"), "rebalance");

    expect(await screen.findByText("Rebalance planning")).toBeInTheDocument();
    expect(screen.getByText("Knowledge base")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=rebalance");
  });

  it("navigates to a selected result and closes", async () => {
    const onNavigate = vi.fn();
    render(<GlobalSearch onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByLabelText("Search everything"), "rebalance");
    await userEvent.click(await screen.findByText("Rebalance planning"));

    expect(pushMock).toHaveBeenCalledWith("/chat/t1");
    expect(onNavigate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a loading state instead of a premature 'No results.' on a cold search (F-20)", async () => {
    let resolveFetch!: (value: unknown) => void;
    const gate = new Promise((resolve) => (resolveFetch = resolve));
    fetchMock.mockReset().mockReturnValue(gate);

    render(<GlobalSearch />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByLabelText("Search everything"), "glossary");

    // While the search is still in flight, the palette must not claim emptiness.
    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByText("No results.")).toBeNull();

    // The search settles with nothing: now the honest negative is allowed.
    resolveFetch({ ok: true, json: async () => ({ groups: [] }) });
    expect(await screen.findByText("No results.")).toBeInTheDocument();
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("selects the first result on Enter", async () => {
    render(<GlobalSearch />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByLabelText("Search everything");
    await userEvent.type(input, "rebalance");
    await screen.findByText("Rebalance planning");
    await userEvent.type(input, "{Enter}");
    expect(pushMock).toHaveBeenCalledWith("/chat/t1");
  });
});

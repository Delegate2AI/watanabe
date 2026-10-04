// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceCard } from "./source-card";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SourceCard", () => {
  it("renders the KB path and its visibility as a button", () => {
    render(<SourceCard path="meetings/2026/q3-exec-sync" visibility="exec" />);
    const trigger = screen.getByRole("button", { name: /meetings\/2026\/q3-exec-sync/ });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByText(/visibility: exec/)).toBeInTheDocument();
  });

  it("omits the visibility label entirely when the tool did not report one", () => {
    // `kb_read` returns the file text and no clearance metadata, so the card
    // used to print "visibility: all-hands" on every citation from a hardcoded
    // fallback, asserting a clearance nothing had told it. The real label is
    // shown in the dialog, from the doc the API actually returns.
    render(<SourceCard path="product/MERIDIAN_Strategic_Plan_v1_2.md" />);
    expect(
      screen.getByRole("button", { name: /MERIDIAN_Strategic_Plan_v1_2\.md/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/visibility:/)).not.toBeInTheDocument();
  });

  it("opens an overlay and previews the fetched document as markdown", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          path: "00-overview/executive-summary.md",
          title: "Executive Summary",
          visibility: "all-hands",
          body: "## Section One\n\n**Meridian** is the Web3 expansion.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<SourceCard path="00-overview/executive-summary.md" visibility="all-hands" />);
    await userEvent.click(screen.getByRole("button", { name: /executive-summary\.md/ }));

    // The doc's title lands in the dialog header, and the body renders as
    // markdown: a real heading element and a <strong>, not literal #/** markers.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(await screen.findByText("Executive Summary")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Section One" })).toBeInTheDocument();
    const strong = await screen.findByText("Meridian");
    expect(strong.tagName).toBe("STRONG");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kb/doc?path=00-overview%2Fexecutive-summary.md",
    );
  });

  it("shows a friendly message when the document is unavailable (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );

    render(<SourceCard path="restricted/secret.md" visibility="restricted" />);
    await userEvent.click(screen.getByRole("button", { name: /secret\.md/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/restricted or moved/i);
  });
});

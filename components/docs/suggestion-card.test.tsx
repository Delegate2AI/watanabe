// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SuggestionCard } from "./suggestion-card";
import type { Suggestion } from "@/lib/shared-docs/types";

afterEach(cleanup);

const base: Suggestion = {
  id: "s1", docId: "d1", baseVersion: 1,
  anchor: { quote: "quick", prefix: "", suffix: "", start: 0 },
  originalText: "quick", proposedText: "slow", note: "tone",
  status: "pending", createdBy: "b@x.com", createdAt: "2026-07-11T00:01:00.000Z",
  resolvedBy: null, resolvedAt: null, appliedVersion: null,
};

describe("SuggestionCard", () => {
  it("shows original and proposed text and accept/reject when canEdit", () => {
    render(<SuggestionCard suggestion={base} canEdit onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("quick")).toBeTruthy();
    expect(screen.getByText("slow")).toBeTruthy();
    expect(screen.getByRole("button", { name: /accept/i })).toBeTruthy();
  });

  it("hides accept/reject when not canEdit", () => {
    render(<SuggestionCard suggestion={base} canEdit={false} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("shows a stale notice for a stale suggestion", () => {
    render(<SuggestionCard suggestion={{ ...base, status: "stale" }} canEdit onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/could not|stale|by hand/i)).toBeTruthy();
  });

  it("renders removed and added as separate labelled nodes, removed first", () => {
    render(<SuggestionCard suggestion={base} canEdit onAccept={vi.fn()} onReject={vi.fn()} />);
    const removedLabel = screen.getByText("Removed");
    const addedLabel = screen.getByText("Added");
    expect(removedLabel).not.toBe(addedLabel);
    // Removed sits above added in document order, so the diff reads top to bottom.
    expect(removedLabel.compareDocumentPosition(addedLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Each label owns its own text node, so neither half can absorb the other.
    expect(removedLabel.parentElement?.textContent).toContain("quick");
    expect(removedLabel.parentElement?.textContent).not.toContain("slow");
    expect(addedLabel.parentElement?.textContent).toContain("slow");
  });

  it("colours removed and added conventionally", () => {
    render(<SuggestionCard suggestion={base} canEdit onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("quick").className).toContain("bg-warn-soft");
    expect(screen.getByText("slow").className).toContain("bg-good-soft");
  });

  it("names the author and when the edit was proposed", () => {
    const { container } = render(
      <SuggestionCard
        suggestion={base}
        canEdit
        onAccept={vi.fn()}
        onReject={vi.fn()}
        author={{ email: "b@x.com", name: "Bea Cole", initials: "BC", isSelf: false }}
      />,
    );
    expect(screen.getByText("Bea Cole")).toBeTruthy();
    expect(container.querySelector('time[datetime="2026-07-11T00:01:00.000Z"]')).not.toBeNull();
  });

  it("shows a deletion as an empty added side rather than a blank row", () => {
    render(
      <SuggestionCard
        suggestion={{ ...base, proposedText: "" }}
        canEdit
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("(nothing)")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { DocMargin } from "./doc-margin";
import type { CommentThread, Suggestion } from "@/lib/shared-docs/types";

afterEach(cleanup);

function thread(id: string, status: "open" | "resolved"): CommentThread {
  return {
    id, docId: "d1", anchor: null, status,
    createdBy: "a@x.com", createdAt: "2026-07-11T00:01:00.000Z",
    resolvedBy: null, resolvedAt: null,
    messages: [{ id: `${id}-m`, authorEmail: "a@x.com", body: `body ${id}`, createdAt: "2026-07-11T00:01:00.000Z" }],
  };
}

function suggestion(id: string, status: Suggestion["status"], proposed: string): Suggestion {
  return {
    id, docId: "d1", baseVersion: 1,
    anchor: { quote: "quick", prefix: "", suffix: "", start: 0 },
    originalText: "quick", proposedText: proposed, note: null,
    status, createdBy: "b@x.com", createdAt: "2026-07-11T00:01:00.000Z",
    resolvedBy: null, resolvedAt: null, appliedVersion: null,
  };
}

function renderMargin(props: Partial<React.ComponentProps<typeof DocMargin>> = {}) {
  return render(
    <DocMargin threads={[]} canComment onReply={vi.fn()} onResolve={vi.fn()} {...props} />,
  );
}

describe("DocMargin", () => {
  it("counts resolved comments and settled suggestions in one disclosure", () => {
    renderMargin({
      threads: [thread("t1", "open"), thread("t2", "resolved")],
      suggestions: [suggestion("s1", "pending", "slow"), suggestion("s2", "accepted", "steady")],
    });
    expect(screen.getByText("Resolved (2)")).toBeTruthy();
  });

  it("puts an accepted suggestion inside the disclosure, not at full size above", () => {
    const { container } = renderMargin({
      suggestions: [suggestion("s1", "accepted", "steady")],
    });
    const details = container.querySelector("details")!;
    expect(within(details).getByText("steady")).toBeTruthy();
  });

  it("puts a rejected suggestion inside the disclosure too", () => {
    const { container } = renderMargin({ suggestions: [suggestion("s1", "rejected", "nope")] });
    const details = container.querySelector("details")!;
    expect(within(details).getByText("nope")).toBeTruthy();
  });

  it("keeps a pending suggestion out of the disclosure", () => {
    const { container } = renderMargin({ suggestions: [suggestion("s1", "pending", "slow")] });
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("slow")).toBeTruthy();
  });

  it("keeps a stale suggestion live: it still needs a person to apply it", () => {
    const { container } = renderMargin({ suggestions: [suggestion("s1", "stale", "drifted")] });
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("drifted")).toBeTruthy();
  });

  it("shows the empty state only when there is nothing at all", () => {
    renderMargin();
    expect(screen.getByText(/no comments yet/i)).toBeTruthy();
    cleanup();
    renderMargin({ suggestions: [suggestion("s1", "accepted", "steady")] });
    expect(screen.queryByText(/no comments yet/i)).toBeNull();
  });
});

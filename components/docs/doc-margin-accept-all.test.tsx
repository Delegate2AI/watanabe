// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocMargin } from "./doc-margin";
import type { Suggestion } from "@/lib/shared-docs/types";

afterEach(cleanup);

function pending(id: string, via: string | null = null): Suggestion {
  return {
    id, docId: "d1", baseVersion: 1,
    anchor: { quote: "old", prefix: "", suffix: "", start: 0 },
    originalText: "old", proposedText: "new", note: null, status: "pending",
    createdBy: "bob@example.com", createdAt: "2026-08-27T10:00:00Z",
    resolvedBy: null, resolvedAt: null, appliedVersion: null, via,
  };
}

function renderMargin(suggestions: Suggestion[], overrides: Partial<React.ComponentProps<typeof DocMargin>> = {}) {
  return render(
    <DocMargin
      threads={[]}
      suggestions={suggestions}
      canComment
      canEdit
      onReply={async () => {}}
      onResolve={async () => {}}
      onAccept={async () => {}}
      onReject={async () => {}}
      {...overrides}
    />,
  );
}

describe("DocMargin: accept all pending (spec 2026-08-27)", () => {
  it("renders only for edit tier with more than one pending suggestion", () => {
    renderMargin([pending("s1")]);
    expect(screen.queryByRole("button", { name: /Accept all pending/ })).toBeNull();
    cleanup();
    renderMargin([pending("s1"), pending("s2")], { canEdit: false });
    expect(screen.queryByRole("button", { name: /Accept all pending/ })).toBeNull();
    cleanup();
    renderMargin([pending("s1"), pending("s2")]);
    expect(screen.getByRole("button", { name: "Accept all pending (2)" })).toBeTruthy();
  });

  it("accepts sequentially and continues past a failing item", async () => {
    const accepted: string[] = [];
    const onAccept = vi.fn(async (id: string) => {
      if (id === "s2") throw new Error("stale");
      accepted.push(id);
    });
    renderMargin([pending("s1"), pending("s2"), pending("s3")], { onAccept });
    await userEvent.click(screen.getByRole("button", { name: "Accept all pending (3)" }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(3));
    expect(accepted).toEqual(["s1", "s3"]);
  });

  it("badges a copilot-authored suggestion", () => {
    renderMargin([pending("s1", "copilot"), pending("s2")]);
    expect(screen.getAllByText("via Copilot")).toHaveLength(1);
  });
});

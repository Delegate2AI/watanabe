// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnotatedDoc } from "./annotated-doc";
import { plainTextOf, rangeFromOffsets } from "@/lib/shared-docs/rendered-text";
import { createAnchor } from "@/lib/shared-docs/anchor";
import type { CommentThread, Suggestion } from "@/lib/shared-docs/types";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BODY = "Hello world text";

function pendingSuggestion(id: string): Suggestion {
  return {
    id, docId: "d1", baseVersion: 1, anchor: createAnchor(BODY, 0, 5),
    originalText: "Hello", proposedText: "Hi", note: null, status: "pending",
    createdBy: "bob@example.com", createdAt: "2026-08-27T10:00:00Z",
    resolvedBy: null, resolvedAt: null, appliedVersion: null, via: "copilot",
  };
}

function renderDoc(overrides: Partial<React.ComponentProps<typeof AnnotatedDoc>> = {}) {
  return render(
    <AnnotatedDoc
      doc={{ id: "d1", body: BODY }}
      access={{ canComment: true, canEdit: true }}
      initialThreads={[] as CommentThread[]}
      initialSuggestions={[] as Suggestion[]}
      {...overrides}
    />,
  );
}

function selectText(container: HTMLElement, substring: string) {
  const article = container.querySelector("article")!;
  const text = plainTextOf(article);
  const start = text.indexOf(substring);
  const range = rangeFromOffsets(article, start, start + substring.length)!;
  range.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  fireEvent.mouseUp(article);
}

describe("AnnotatedDoc: the copilot rail (spec 2026-08-27)", () => {
  it("renders no rail tabs and no copilot affordance when disabled (byte-path unchanged)", () => {
    const { container } = renderDoc();
    expect(screen.queryByRole("tablist", { name: "Document rail" })).toBeNull();
    selectText(container, "world");
    expect(screen.queryByRole("button", { name: "Ask copilot" })).toBeNull();
  });

  it("tabs the rail, counts pending suggestions on Review, and opens the panel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    renderDoc({
      copilotEnabled: true,
      docTitle: "Plan",
      initialSuggestions: [pendingSuggestion("s1"), pendingSuggestion("s2")],
    });
    const rail = screen.getByRole("tablist", { name: "Document rail" });
    expect(rail).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Review2" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Copilot" }));
    expect(screen.getByText("Summarize this document")).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask about this document")).toBeTruthy();
  });

  it("hands a selection to the copilot tab as a removable quote", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { container } = renderDoc({ copilotEnabled: true, docTitle: "Plan" });
    selectText(container, "world");
    await userEvent.click(screen.getByRole("button", { name: "Ask copilot" }));
    // The panel is front and carries the quote chip.
    expect(screen.getByText(/"world"/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove selection" }));
    expect(screen.queryByText(/"world"/)).toBeNull();
  });
});

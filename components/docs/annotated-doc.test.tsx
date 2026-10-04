// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnotatedDoc } from "./annotated-doc";
import { plainTextOf, rangeFromOffsets } from "@/lib/shared-docs/rendered-text";
import type { CommentThread, Suggestion } from "@/lib/shared-docs/types";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  routerRefresh.mockReset();
});

function renderDoc(overrides: Partial<React.ComponentProps<typeof AnnotatedDoc>> = {}) {
  return render(
    <AnnotatedDoc
      doc={{ id: "d1", body: "Hello world text" }}
      access={{ canComment: true, canEdit: true }}
      initialThreads={[] as CommentThread[]}
      initialSuggestions={[] as Suggestion[]}
      {...overrides}
    />,
  );
}

/** Select `substring` inside the rendered `<article>` and fire the mouseup the
 * component listens on, exactly as a real text selection would. */
function selectText(container: HTMLElement, substring: string) {
  const article = container.querySelector("article")!;
  const text = plainTextOf(article);
  const start = text.indexOf(substring);
  const range = rangeFromOffsets(article, start, start + substring.length)!;
  // jsdom does no layout, so Range has no getBoundingClientRect; the component
  // only reads it for bubble positioning, which these tests don't assert on.
  range.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  fireEvent.mouseUp(article);
}

async function openSuggestComposer(container: HTMLElement, substring: string) {
  selectText(container, substring);
  await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
}

describe("AnnotatedDoc: direct editing for edit-access users (review fix #6)", () => {
  it("shows the Editing mode when canEdit, and selecting it swaps in the DocEditor with no duplicate body", async () => {
    const { container } = renderDoc({ access: { canComment: true, canEdit: true } });
    await userEvent.click(screen.getByRole("tab", { name: "Editing" }));
    // DocEditor's own editing UI (a fresh save affordance) is visible...
    expect(screen.getByRole("button", { name: "Save version" })).toBeTruthy();
    // ...and the rendered body (the paper <article>) is gone, so there is never
    // a rendered body plus a second editable copy at once.
    expect(container.querySelector("article")).toBeNull();
  });

  it("hides the Editing mode when the caller lacks edit access", () => {
    renderDoc({ access: { canComment: true, canEdit: false } });
    expect(screen.queryByRole("tab", { name: "Editing" })).toBeNull();
  });

  it("returns to the annotation view and refreshes the page after a successful save", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { container } = renderDoc();
    await userEvent.click(screen.getByRole("tab", { name: "Editing" }));
    await userEvent.click(screen.getByRole("button", { name: "Save version" }));
    await waitFor(() => expect(container.querySelector("article")).not.toBeNull());
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("returns to the annotation view on cancel without refreshing", async () => {
    const { container } = renderDoc();
    await userEvent.click(screen.getByRole("tab", { name: "Editing" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.querySelector("article")).not.toBeNull();
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});

describe("AnnotatedDoc: Viewing (preview) blocks new anchors (review fix #7)", () => {
  it("does not open the selection bubble while viewing", async () => {
    const { container } = renderDoc();
    await userEvent.click(screen.getByRole("tab", { name: "Viewing" }));
    selectText(container, "world");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows an inline hint that Suggesting is required to comment", async () => {
    renderDoc();
    await userEvent.click(screen.getByRole("tab", { name: "Viewing" }));
    expect(screen.getByText(/switch to suggesting/i)).toBeTruthy();
  });

  it("does open the selection bubble when suggesting (control)", () => {
    const { container } = renderDoc();
    selectText(container, "world");
    expect(screen.queryByRole("menu")).not.toBeNull();
  });
});

describe("AnnotatedDoc: suggestion composer allows deletions and preserves whitespace (review fix #8)", () => {
  it("submits an empty replacement as a deletion when the original selection is non-empty", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { container } = renderDoc();
    await openSuggestComposer(container, "world");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/docs/d1/suggestions", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.anchor.quote).toBe("world");
    expect(sent.proposedText).toBe("");
    expect(sent.originalText).toBeUndefined();
  });

  it("sends a replacement's leading/trailing whitespace untrimmed", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { container } = renderDoc();
    await openSuggestComposer(container, "world");
    await userEvent.type(screen.getByPlaceholderText(/proposed replacement/i), " spaced ");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.proposedText).toBe(" spaced ");
  });
});

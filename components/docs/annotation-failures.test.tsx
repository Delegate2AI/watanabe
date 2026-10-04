// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnotatedDoc } from "./annotated-doc";
import { plainTextOf, rangeFromOffsets } from "@/lib/shared-docs/rendered-text";
import type { Suggestion } from "@/lib/shared-docs/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pending: Suggestion = {
  id: "s1",
  docId: "d1",
  anchor: { quote: "world", prefix: "Hello ", suffix: " text", start: 6, end: 11 },
  originalText: "world",
  proposedText: "planet",
  note: null,
  status: "pending",
  baseVersion: 1,
  createdBy: "maria@example.com",
  createdAt: "2026-07-22T00:00:00Z",
  decidedBy: null,
  decidedAt: null,
  appliedVersion: null,
};

function renderDoc(suggestions: Suggestion[]) {
  return render(
    <AnnotatedDoc
      doc={{ id: "d1", body: "Hello world text" }}
      access={{ canComment: true, canEdit: true }}
      initialThreads={[]}
      initialSuggestions={suggestions}
    />,
  );
}

/**
 * Every mutation on the annotation surface used to end in `if (!res.ok) return`,
 * so a rejected accept, reject or proposal was indistinguishable from a click
 * that never registered. The accept case was the worst of the three: the server
 * marks the suggestion `stale` on the way to its 409, so the client's view was
 * not merely un-updated but actively wrong until the ~10s poll happened to land.
 */
describe("AnnotatedDoc failure reporting", () => {
  it("reports a rejected accept and re-reads the suggestion the server just staled", async () => {
    const staled = { ...pending, status: "stale" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify({ error: { code: "conflict" } }), { status: 409 });
        }
        if (String(url).endsWith("/suggestions")) {
          return new Response(JSON.stringify({ suggestions: [staled] }), { status: 200 });
        }
        return new Response(JSON.stringify({ threads: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    renderDoc([pending]);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be applied/i);
    // The refreshed card explains itself, and its decision buttons are gone.
    await waitFor(() => expect(screen.getByText(/could not auto-apply/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("reports a rejected reject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify({ error: { code: "needs_role" } }), { status: 403 });
        }
        if (String(url).endsWith("/suggestions")) {
          return new Response(JSON.stringify({ suggestions: [pending] }), { status: 200 });
        }
        return new Response(JSON.stringify({ threads: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    renderDoc([pending]);
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/editor access/i);
  });

  it("keeps a failed proposal in the composer and says why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ error: { code: "needs_role" } }), { status: 403 });
        }
        return new Response(JSON.stringify({ suggestions: [], threads: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    );
    const { container } = renderDoc([]);
    const article = container.querySelector("article")!;
    const text = plainTextOf(article);
    const start = text.indexOf("world");
    const range = rangeFromOffsets(article, start, start + 5)!;
    range.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(article);
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    const field = await screen.findByPlaceholderText("Proposed replacement (blank to delete)");
    await userEvent.type(field, "planet");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/editor access/i);
    // The draft survives, so the proposal does not have to be retyped.
    expect(screen.getByPlaceholderText("Proposed replacement (blank to delete)")).toHaveValue("planet");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDocAnnotations } from "./use-doc-annotations";
import type { CommentThread, Suggestion } from "@/lib/shared-docs/types";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  routerRefresh.mockReset();
});

function thread(id: string): CommentThread {
  return {
    id, docId: "d1", anchor: null, status: "open",
    createdBy: "a@x.com", createdAt: "2026-07-11T00:00:00.000Z",
    resolvedBy: null, resolvedAt: null, messages: [],
  };
}

function suggestion(id: string): Suggestion {
  return {
    id, docId: "d1", baseVersion: 1,
    anchor: { quote: "quick", prefix: "", suffix: "", start: 0 },
    originalText: "quick", proposedText: "slow", note: null,
    status: "pending", createdBy: "a@x.com", createdAt: "2026-07-11T00:00:00.000Z",
    resolvedBy: null, resolvedAt: null, appliedVersion: null,
  };
}

describe("useDocAnnotations refresh (Promise.allSettled, spec 2026-07-22 review fix #10)", () => {
  it("applies the fulfilled endpoint's result even when the other fetch rejects", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/comments")) throw new Error("network down");
      return new Response(JSON.stringify({ suggestions: [suggestion("s1")] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useDocAnnotations("d1", [thread("t1")], []));
    void result.current.refresh();

    await waitFor(() => expect(result.current.suggestions.map((s) => s.id)).toEqual(["s1"]));
    // The rejecting comments fetch must not discard the threads that were
    // already loaded, nor should the whole refresh() call reject.
    expect(result.current.threads.map((t) => t.id)).toEqual(["t1"]);
  });

  it("onReply throws (and does not refresh) when the POST is not ok", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useDocAnnotations("d1", [], []));
    await expect(result.current.onReply("t1", "hi")).rejects.toThrow();
    // Only the reply POST fired; a failed reply never triggers the refresh GETs.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads a suggestion decision the server refused, but not a comment one", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "conflict" } }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useDocAnnotations("d1", [], []));

    // A refused resolve changed nothing on the server, so there is nothing to
    // re-read: one PATCH, no refresh.
    await result.current.onResolve("t1", "resolved");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A refused accept or reject is different: `setSuggestionStatus` may have
    // moved the row (a 409 accept is the route marking it `stale`), so the
    // client's copy is now wrong and each is followed by the two refresh GETs.
    fetchMock.mockClear();
    await result.current.onAccept("s1");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    await result.current.onReject("s2");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The document body is only re-fetched when a version was actually written.
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("reports the reason a decision was refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "conflict" } }), { status: 409 })) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useDocAnnotations("d1", [], []));
    await result.current.onAccept("s1");
    await waitFor(() => expect(result.current.error).toMatch(/could not be applied/i));
  });
});

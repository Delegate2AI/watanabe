// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChat } from "./use-chat";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChat canvas hydration (spec 29)", () => {
  it("hydrates thread chat documents on resume only when the canvas is enabled", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/chat-docs?thread=")) {
        return new Response(
          JSON.stringify({ docs: [{ id: "d1", title: "Memo", currentVersion: 2, updatedAt: "x" }] }),
          { status: 200 },
        );
      }
      // Transcript hydration and anything else: empty.
      return new Response(JSON.stringify({ turns: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    // Flag off: no hydration request, empty threadDocs (byte-identical network).
    const off = renderHook(() => useChat("sess-1", { canvasEnabled: false }));
    await waitFor(() => expect(off.result.current.threadDocs).toEqual([]));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/chat-docs?thread="))).toBe(false);

    // Flag on + resume: threadDocs hydrated from the list endpoint.
    const on = renderHook(() => useChat("sess-1", { canvasEnabled: true }));
    await waitFor(() => expect(on.result.current.threadDocs.map((d) => d.id)).toEqual(["d1"]));
  });
});

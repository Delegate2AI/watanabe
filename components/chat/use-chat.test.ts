// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChat } from "./use-chat";
import { ndjsonResponse } from "./use-chat-test-helpers";

describe("useChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically appends a user turn and grows the assistant turn from partial events", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { type: "session", sessionId: "11111111-1111-4111-8111-111111111111" },
        { type: "text_delta", delta: "Hel" },
        { type: "text_delta", delta: "lo" },
        { type: "turn_result", ok: true, costUsd: 0.01, sessionCostUsd: 0.01, durationMs: 5 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi there");
    });

    // user turn first, then a completed assistant turn holding "Hello".
    expect(result.current.turns[0]).toMatchObject({ role: "user", content: "hi there" });
    const assistant = result.current.turns[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.role === "assistant" && assistant.segments[0]).toMatchObject({
      kind: "text",
      text: "Hello",
    });
    expect(assistant.role === "assistant" && assistant.status).toBe("done");
    expect(result.current.status).toBe("idle");
  });

  it("reports streaming status while a turn is in flight and idle after", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "text_delta", delta: "x" }) + "\n"));
          await gate;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "turn_result",
                ok: true,
                costUsd: 0,
                sessionCostUsd: 0,
                durationMs: 1,
              }) + "\n",
            ),
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat());
    let done!: Promise<void>;
    act(() => {
      done = result.current.send("go");
    });
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    await act(async () => {
      release();
      await done;
    });
    expect(result.current.status).toBe("idle");
  });

  it("interrupt posts to the interrupt route and stops the stream", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/agent/interrupt") return new Response("{}", { status: 200 });
      return ndjsonResponse([
        { type: "session", sessionId: "22222222-2222-4222-8222-222222222222" },
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("hi");
    });
    await act(async () => {
      await result.current.interrupt();
    });
    expect(calls).toContain("/api/agent/interrupt");
  });

  it("interrupt during an ACTIVE stream aborts the reader and does not error the turn", async () => {
    // A never-closing stream that errors with AbortError when the request's
    // signal aborts, mirroring how real fetch cancels the body on abort.
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/agent/interrupt") return new Response("{}", { status: 200 });
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('{"type":"session","sessionId":"55555555-5555-4555-8555-555555555555"}\n'),
          );
          controller.enqueue(encoder.encode('{"type":"text_delta","delta":"partial"}\n'));
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
          // otherwise never closes: stays active until aborted
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useChat());
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    await act(async () => {
      await result.current.interrupt();
      await sendPromise;
    });
    expect(result.current.status).toBe("idle");
    // The interrupt path (not the dropped-stream reconnect path) ran: no error.
    const assistant = result.current.turns.find((t) => t.role === "assistant");
    expect(assistant && "status" in assistant ? assistant.status : undefined).not.toBe("error");
  });
});

describe("useChat, pending connector consumption", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function bodyOf(call: unknown[]): { connectors?: string[] } {
    return JSON.parse(String((call[1] as RequestInit).body)) as { connectors?: string[] };
  }

  it("connectors ride only the first fresh send and the url param is dropped on consumption", async () => {
    window.history.replaceState(null, "", "/chat/handle-1?connector=circleback");
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { type: "session", sessionId: "33333333-3333-4333-8333-333333333333" },
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat("handle-1", { isNew: true, pendingConnectors: ["circleback"] }),
    );
    await act(async () => {
      await result.current.send("first");
    });
    await act(async () => {
      await result.current.send("second");
    });

    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ connectors: ["circleback"] });
    expect(bodyOf(fetchMock.mock.calls[1]).connectors).toBeUndefined();
    expect(window.location.search).not.toContain("connector");
  });

  it("a send after a FAILED first send carries no connectors and the url param is already gone", async () => {
    window.history.replaceState(null, "", "/chat/handle-2?connector=circleback");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "internal" } }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "session", sessionId: "44444444-4444-4444-8444-444444444444" },
          { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat("handle-2", { isNew: true, pendingConnectors: ["circleback"] }),
    );
    await act(async () => {
      await result.current.send("first");
    });
    expect(window.location.search).not.toContain("connector");

    await act(async () => {
      await result.current.send("second");
    });

    expect(bodyOf(fetchMock.mock.calls[1]).connectors).toBeUndefined();
    expect(window.location.search).not.toContain("connector");
  });

  it("sends the model choice on a first send", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { type: "session", sessionId: "11111111-1111-4111-8111-111111111111" },
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat("client-handle", {
        isNew: true,
        modelChoice: { model: "claude-fable-5-1", effort: "max" },
      }),
    );
    await act(async () => {
      await result.current.send("hello");
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.sessionId).toBeUndefined();
    expect(body.model).toBe("claude-fable-5-1");
    expect(body.effort).toBe("max");
  });

  it("omits the model choice on a resumed send", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/agent/sessions?id=")) {
        return new Response(JSON.stringify({ turns: [] }), { status: 200 });
      }
      void init;
      return ndjsonResponse([
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() =>
      useChat("11111111-1111-4111-8111-111111111111", {
        modelChoice: { model: "claude-fable-5-1" },
      }),
    );
    await act(async () => {
      await result.current.send("again");
    });

    const post = fetchMock.mock.calls.find((call) => String(call[0]) === "/api/agent");
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body.sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.model).toBeUndefined();
    expect(body.effort).toBeUndefined();
  });

});

describe("useChat, a pre-minted thread", () => {
  it("sends a pre-minted thread id on the very first send", async () => {
    const fetchMock = vi.fn(async () => ndjsonResponse([{ type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat("premint-1", { isNew: true, preMinted: true }));
    await act(async () => {
      await result.current.send("hello");
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.sessionId).toBe("premint-1");
  });

  it("still sends no session id for a new thread that was not pre-minted", async () => {
    const fetchMock = vi.fn(async () => ndjsonResponse([{ type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat("client-handle", { isNew: true }));
    await act(async () => {
      await result.current.send("hello");
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.sessionId).toBeUndefined();
  });

  it("does not hydrate a transcript for a pre-minted thread", async () => {
    const fetchMock = vi.fn(async () => ndjsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useChat("premint-1", { isNew: true, preMinted: true }));
    await act(async () => {});
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/agent/sessions"))).toBe(false);
  });
});

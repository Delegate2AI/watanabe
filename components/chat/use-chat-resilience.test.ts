// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChat } from "./use-chat";
import { ndjsonResponse } from "./use-chat-test-helpers";

/**
 * Lifecycle and stream-resilience contracts for useChat: surviving an unmount,
 * transcript hydration on resume, tolerating malformed/truncated frames, and
 * reconnecting from the transcript when a live stream drops mid-turn.
 */
describe("useChat (lifecycle & resilience)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unmounting mid-stream does NOT abort the in-flight turn (F-01: a Strict Mode remount must keep a seeded send alive)", async () => {
    let capturedSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('{"type":"text_delta","delta":"partial"}\n'));
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
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result, unmount } = renderHook(() => useChat());
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send("seed question");
    });
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    // The component goes away (this mirrors Strict Mode's synthetic unmount, which
    // Home's seed send lands inside of). The in-flight request must survive it.
    unmount();
    expect(capturedSignal?.aborted).toBe(false);
    // And the started turn still runs to completion in the background.
    await act(async () => {
      release();
      await sendPromise;
    });
  });

  it("hydrates the transcript for an existing thread id on mount", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/agent/sessions?id=")) {
        return new Response(
          JSON.stringify({
            turns: [
              { id: "u1", role: "user", content: "old question" },
              { id: "a1", role: "assistant", segments: [{ kind: "text", text: "old answer" }], status: "done" },
            ],
            active: false,
          }),
          { status: 200 },
        );
      }
      return ndjsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useChat("33333333-3333-4333-8333-333333333333"));
    await waitFor(() => expect(result.current.turns.length).toBe(2));
    expect(result.current.turns[0]).toMatchObject({ role: "user", content: "old question" });
  });

  it("skips a malformed line and still folds the valid events", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"text_delta","delta":"a"}\n'));
          controller.enqueue(encoder.encode("this is not json\n"));
          controller.enqueue(encoder.encode('{"type":"text_delta","delta":"b"}\n'));
          controller.enqueue(
            encoder.encode('{"type":"turn_result","ok":true,"costUsd":0,"sessionCostUsd":0,"durationMs":1}\n'),
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("go");
    });
    const assistant = result.current.turns[1];
    expect(assistant.role === "assistant" && assistant.segments[0]).toMatchObject({ kind: "text", text: "ab" });
  });

  it("parses a truncated final event that has no trailing newline", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"text_delta","delta":"x"}\n'));
          // Last event arrives with NO trailing newline (a truncated frame).
          controller.enqueue(
            encoder.encode('{"type":"turn_result","ok":true,"costUsd":0,"sessionCostUsd":0,"durationMs":1}'),
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("go");
    });
    const assistant = result.current.turns[1];
    expect(assistant.role === "assistant" && assistant.status).toBe("done");
  });

  it("reconnects from the transcript when the stream drops mid-turn (does not error)", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/agent") {
        // Emit the session id and a partial delta on separate reads, THEN drop
        // the stream. A pull-based stream delivers the prior chunks before the
        // error (unlike controller.error(), which discards the queued chunks).
        let stage = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (stage === 0) {
              controller.enqueue(
                encoder.encode('{"type":"session","sessionId":"44444444-4444-4444-8444-444444444444"}\n'),
              );
              stage = 1;
            } else if (stage === 1) {
              controller.enqueue(encoder.encode('{"type":"text_delta","delta":"par"}\n'));
              stage = 2;
            } else {
              throw new Error("network drop");
            }
          },
        });
        return new Response(body, { status: 200 });
      }
      // Reconnect fetch: the run finished server-side, transcript is final.
      if (url.startsWith("/api/agent/sessions?id=")) {
        return new Response(
          JSON.stringify({
            turns: [
              { id: "u", role: "user", content: "q" },
              { id: "a", role: "assistant", segments: [{ kind: "text", text: "full answer" }], status: "done" },
            ],
            active: false,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send("q");
    });
    // The dropped stream rehydrated from the transcript, no error bubble.
    await waitFor(() => expect(result.current.turns.some((t) => t.role === "assistant" && t.status === "done")).toBe(true));
    const assistant = result.current.turns.find((t) => t.role === "assistant");
    expect(assistant && "error" in assistant ? assistant.error : undefined).toBeUndefined();
    expect(result.current.status).toBe("idle");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChat } from "./use-chat";
import { ndjsonResponse } from "./use-chat-test-helpers";

const PREMINTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChat, the first send of a pre-minted thread", () => {
  it("carries the model choice chosen on Home", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { type: "session", sessionId: PREMINTED },
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat(PREMINTED, {
        isNew: true,
        preMinted: true,
        modelChoice: { model: "claude-fable-5-1", effort: "max" },
      }),
    );
    await act(async () => {
      await result.current.send("hello");
    });

    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.sessionId).toBe(PREMINTED);
    expect(body.model).toBe("claude-fable-5-1");
    expect(body.effort).toBe("max");
  });

  it("carries the connector chosen on Home", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { type: "session", sessionId: PREMINTED },
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat(PREMINTED, { isNew: true, preMinted: true, pendingConnectors: ["circleback"] }),
    );
    await act(async () => {
      await result.current.send("hello");
    });

    expect(bodyOf(fetchMock.mock.calls[0]).connectors).toEqual(["circleback"]);
  });

  it("stops carrying the choice on the next send of the same thread", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { type: "session", sessionId: PREMINTED },
        { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat(PREMINTED, {
        isNew: true,
        preMinted: true,
        modelChoice: { model: "claude-fable-5-1", effort: "max" },
      }),
    );
    await act(async () => {
      await result.current.send("hello");
    });
    await act(async () => {
      await result.current.send("again");
    });

    const second = bodyOf(fetchMock.mock.calls[1]);
    expect(second.sessionId).toBe(PREMINTED);
    expect(second.model).toBeUndefined();
    expect(second.effort).toBeUndefined();
  });

  it("keeps carrying the choice when the first turn fails after announcing the id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "session", sessionId: PREMINTED },
          { type: "error", message: "subprocess failed to start" },
        ]),
      )
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "session", sessionId: PREMINTED },
          { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChat(PREMINTED, {
        isNew: true,
        preMinted: true,
        modelChoice: { model: "claude-fable-5-1", effort: "max" },
      }),
    );
    await act(async () => {
      await result.current.send("hello");
    });
    await act(async () => {
      await result.current.send("again");
    });

    const retry = bodyOf(fetchMock.mock.calls[1]);
    expect(retry.sessionId).toBe(PREMINTED);
    expect(retry.model).toBe("claude-fable-5-1");
    expect(retry.effort).toBe("max");
  });
});

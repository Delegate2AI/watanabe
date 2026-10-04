import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { usageFromResult, type ModelSnapshot, type UsageContext } from "./usage-from-result";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const CTX: UsageContext = {
  source: "chat",
  ownerEmail: "alice@example.com",
  threadId: "thread-1",
  at: "2026-09-07T10:00:00.000Z",
};

function modelUsage(over: Partial<Record<string, number>> = {}) {
  return {
    inputTokens: over.inputTokens ?? 0,
    outputTokens: over.outputTokens ?? 0,
    cacheReadInputTokens: over.cacheReadInputTokens ?? 0,
    cacheCreationInputTokens: over.cacheCreationInputTokens ?? 0,
    webSearchRequests: 0,
    costUSD: over.costUSD ?? 0,
    contextWindow: 200000,
    maxOutputTokens: 64000,
  };
}

function result(over: Record<string, unknown>): ResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1200,
    duration_api_ms: 1000,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: "result-1",
    session_id: "thread-1",
    ...over,
  } as unknown as ResultMessage;
}

describe("usageFromResult", () => {
  it("takes the whole figure when there is no prior snapshot", () => {
    const { rows, snapshot } = usageFromResult(
      result({ modelUsage: { "claude-opus-4-8": modelUsage({ inputTokens: 100, outputTokens: 20, costUSD: 0.5 }) } }),
      null,
      CTX,
    );

    expect(rows).toEqual([
      {
        resultId: "result-1",
        at: "2026-09-07T10:00:00.000Z",
        source: "chat",
        ownerEmail: "alice@example.com",
        threadId: "thread-1",
        model: "claude-opus-4-8",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0.5,
        durationMs: 1200,
        ok: true,
      },
    ]);
    expect(snapshot["claude-opus-4-8"]).toMatchObject({ inputTokens: 100, costUsd: 0.5 });
  });

  it("reports the delta against a cumulative snapshot", () => {
    const first = usageFromResult(
      result({ modelUsage: { "claude-opus-4-8": modelUsage({ inputTokens: 100, costUSD: 0.5 }) } }),
      null,
      CTX,
    );
    const second = usageFromResult(
      result({ uuid: "result-2", modelUsage: { "claude-opus-4-8": modelUsage({ inputTokens: 260, costUSD: 1.25 }) } }),
      first.snapshot,
      CTX,
    );

    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]).toMatchObject({ resultId: "result-2", inputTokens: 160, costUsd: 0.75 });
    expect(second.snapshot["claude-opus-4-8"]).toMatchObject({ inputTokens: 260 });
  });

  it("gives a model that appears mid-session its full figure", () => {
    const prev: ModelSnapshot = {
      "claude-opus-4-8": { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.5 },
    };

    const { rows } = usageFromResult(
      result({
        modelUsage: {
          "claude-opus-4-8": modelUsage({ inputTokens: 140, costUSD: 0.7 }),
          "claude-haiku-4-5": modelUsage({ inputTokens: 30, costUSD: 0.01 }),
        },
      }),
      prev,
      CTX,
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.model === "claude-haiku-4-5")).toMatchObject({ inputTokens: 30, costUsd: 0.01 });
    expect(rows.find((row) => row.model === "claude-opus-4-8")).toMatchObject({ inputTokens: 40 });
  });

  it("skips a model that did nothing this turn", () => {
    const prev: ModelSnapshot = {
      "claude-opus-4-8": { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.5 },
    };

    const { rows } = usageFromResult(
      result({ modelUsage: { "claude-opus-4-8": modelUsage({ inputTokens: 100, costUSD: 0.5 }) } }),
      prev,
      CTX,
    );

    expect(rows).toEqual([]);
  });

  it("clamps a counter that went backwards to zero", () => {
    const prev: ModelSnapshot = {
      "claude-opus-4-8": { inputTokens: 500, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 9 },
    };

    const { rows } = usageFromResult(
      result({ modelUsage: { "claude-opus-4-8": modelUsage({ inputTokens: 10, outputTokens: 4, costUSD: 0.1 }) } }),
      prev,
      CTX,
    );

    expect(rows[0]).toMatchObject({ inputTokens: 0, outputTokens: 4, costUsd: 0 });
  });

  it("falls back to `usage` and the named model when modelUsage is empty", () => {
    const { rows } = usageFromResult(
      result({
        modelUsage: {},
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 11,
          output_tokens: 3,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      }),
      null,
      { ...CTX, fallbackModel: "claude-opus-4-8" },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        model: "claude-opus-4-8",
        inputTokens: 11,
        outputTokens: 3,
        cacheReadTokens: 2,
        cacheCreationTokens: 1,
        costUsd: 0.42,
      }),
    ]);
  });

  it("marks a failed result and carries its source and owner", () => {
    const { rows } = usageFromResult(
      result({
        subtype: "error_max_turns",
        modelUsage: { "claude-opus-4-8": modelUsage({ inputTokens: 5, costUSD: 0.01 }) },
      }),
      null,
      { source: "packages", ownerEmail: null, threadId: null, at: "2026-09-07T10:00:00.000Z" },
    );

    expect(rows[0]).toMatchObject({ ok: false, source: "packages", ownerEmail: null, threadId: null });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

let db: import("better-sqlite3").Database;
let getDbThrows = false;

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDb: () => {
      if (getDbThrows) throw new Error("database unavailable");
      return db;
    },
  };
});

const { openDb } = await import("@/lib/db/client");
const { listUsageRows } = await import("@/lib/db/usage-queries");
const { CostTracker, emitTurnResult } = await import("./session-turn");

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const saved = { ...process.env };

function usage(inputTokens: number, costUSD: number) {
  return {
    inputTokens,
    outputTokens: 4,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD,
    contextWindow: 200000,
    maxOutputTokens: 64000,
  };
}

function result(uuid: string, inputTokens: number, costUSD: number): ResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 700,
    duration_api_ms: 600,
    is_error: false,
    num_turns: 1,
    result: "done",
    stop_reason: null,
    total_cost_usd: costUSD,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: { "claude-opus-4-8": usage(inputTokens, costUSD) },
    permission_denials: [],
    uuid,
    session_id: "thread-1",
  } as unknown as ResultMessage;
}

function state(costs: InstanceType<typeof CostTracker>, events: unknown[]) {
  return {
    sdkSessionId: "thread-1",
    ownerEmail: "alice@example.com",
    costs,
    broadcast: (event: unknown) => {
      events.push(event);
    },
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  getDbThrows = false;
  process.env.USAGE_AUDIT_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("emitTurnResult", () => {
  it("still broadcasts the turn result and its costs", () => {
    const events: unknown[] = [];

    emitTurnResult(result("r1", 100, 0.5), state(new CostTracker(0), events));

    expect(events).toEqual([
      { type: "turn_result", costUsd: 0.5, sessionCostUsd: 0.5, durationMs: 700, ok: true, result: "done" },
    ]);
  });

  it("writes the row only after the broadcast has gone out", () => {
    let ledgerAtBroadcast: number | null = null;
    const costs = new CostTracker(0);

    emitTurnResult(result("r1", 100, 0.5), {
      sdkSessionId: "thread-1",
      ownerEmail: "alice@example.com",
      costs,
      broadcast: () => {
        ledgerAtBroadcast = listUsageRows(db, PERIOD).length;
      },
    });

    expect(ledgerAtBroadcast).toBe(0);
    expect(listUsageRows(db, PERIOD)).toHaveLength(1);
  });

  it("writes one chat row per turn, attributed to the owner and the thread", () => {
    const events: unknown[] = [];

    emitTurnResult(result("r1", 100, 0.5), state(new CostTracker(0), events));

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "chat",
      ownerEmail: "alice@example.com",
      threadId: "thread-1",
      model: "claude-opus-4-8",
      inputTokens: 100,
      costUsd: 0.5,
      ok: true,
    });
  });

  it("writes nothing with the flag off", () => {
    process.env.USAGE_AUDIT_ENABLED = "0";
    const events: unknown[] = [];

    emitTurnResult(result("r1", 100, 0.5), state(new CostTracker(0), events));

    expect(listUsageRows(db, PERIOD)).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it("does not break the turn when the ledger write fails", () => {
    const events: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    getDbThrows = true;

    expect(() => emitTurnResult(result("r1", 100, 0.5), state(new CostTracker(0), events))).not.toThrow();
    expect(events).toEqual([
      { type: "turn_result", costUsd: 0.5, sessionCostUsd: 0.5, durationMs: 700, ok: true, result: "done" },
    ]);
  });

  it("charges the second turn only its own share", () => {
    const events: unknown[] = [];
    const costs = new CostTracker(0);

    emitTurnResult(result("r1", 100, 0.5), state(costs, events));
    emitTurnResult(result("r2", 260, 1.25), state(costs, events));

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ resultId: "r2", inputTokens: 160, costUsd: 0.75 });
  });
});

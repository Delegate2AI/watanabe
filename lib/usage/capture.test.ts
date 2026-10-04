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
const { recordThread } = await import("@/lib/db/threads");
const { listUsageRows } = await import("@/lib/db/usage-queries");
const { captureUsage, ownerForThread } = await import("./capture");

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const saved = { ...process.env };

function result(over: Record<string, unknown> = {}): ResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 900,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: null,
    total_cost_usd: 0.5,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      "claude-opus-4-8": {
        inputTokens: 40,
        outputTokens: 8,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.5,
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    },
    permission_denials: [],
    uuid: "result-1",
    session_id: "thread-1",
    ...over,
  } as unknown as ResultMessage;
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

describe("captureUsage", () => {
  it("writes the rows and returns the new snapshot", () => {
    const snapshot = captureUsage(
      result(),
      { source: "chat", ownerEmail: "alice@example.com", threadId: "thread-1", at: "2026-09-07T10:00:00.000Z" },
    );

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "chat", ownerEmail: "alice@example.com", inputTokens: 40 });
    expect(snapshot?.["claude-opus-4-8"]).toMatchObject({ inputTokens: 40 });
  });

  it("writes nothing and returns the previous snapshot with the flag off", () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    const snapshot = captureUsage(result(), { source: "dream", ownerEmail: "a@x.com", threadId: "t" }, null);

    expect(listUsageRows(db, PERIOD)).toEqual([]);
    expect(snapshot).toBeNull();
  });

  it("swallows a database failure, logs it, and returns the previous snapshot", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbThrows = true;
    const prev = {
      "claude-opus-4-8": { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
    };

    expect(() =>
      captureUsage(result(), { source: "quality", ownerEmail: null, threadId: "t" }, prev),
    ).not.toThrow();
    expect(captureUsage(result(), { source: "quality", ownerEmail: null, threadId: "t" }, prev)).toBe(prev);
    expect(error).toHaveBeenCalled();
  });
});

describe("ownerForThread", () => {
  it("resolves the thread's owner", () => {
    recordThread(db, "thread-1", "alice@example.com", "Memo");

    expect(ownerForThread("thread-1")).toBe("alice@example.com");
  });

  it("answers null for no thread, an unknown thread, and an unavailable database", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(ownerForThread(null)).toBeNull();
    expect(ownerForThread("nope")).toBeNull();
    getDbThrows = true;
    expect(ownerForThread("thread-1")).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});

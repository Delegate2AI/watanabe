import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

type QueryOpts = { prompt: string; options: Options };

let fakeAgent: (opts: QueryOpts) => AsyncGenerator<unknown> = async function* () {};
const queryMock = vi.fn((opts: QueryOpts) => fakeAgent(opts));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return { ...actual, query: (opts: QueryOpts) => queryMock(opts) };
});

vi.mock("@/lib/memory/repo-memory", () => ({
  withMemoryLock: async (fn: () => Promise<unknown>) => fn(),
  commitMemoryLocked: async () => "committed",
}));

vi.mock("@/lib/memory/mem-server", () => ({ createMemMcpServer: () => ({}) }));

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
const { runDream } = await import("./dream");

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const saved = { ...process.env };

function resultMessage() {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 4000,
    duration_api_ms: 3800,
    is_error: false,
    num_turns: 6,
    result: "done",
    stop_reason: null,
    total_cost_usd: 0.2,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      "claude-opus-4-8": {
        inputTokens: 900,
        outputTokens: 120,
        cacheReadInputTokens: 40,
        cacheCreationInputTokens: 10,
        webSearchRequests: 0,
        costUSD: 0.2,
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    },
    permission_denials: [],
    uuid: "dream-result-1",
    session_id: "thread-1",
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  getDbThrows = false;
  process.env.USAGE_AUDIT_ENABLED = "1";
  process.env.MEMORY_ENABLED = "1";
  fakeAgent = async function* () {
    yield resultMessage();
  };
});

afterEach(() => {
  process.env = { ...saved };
  queryMock.mockClear();
  vi.restoreAllMocks();
});

describe("runDream usage capture", () => {
  it("records the run against the owner it consolidated for", async () => {
    await runDream({
      sdkSessionId: "thread-1",
      ownerEmail: "alice@example.com",
      transcript: "a conversation worth keeping",
    });

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "dream",
      ownerEmail: "alice@example.com",
      threadId: "thread-1",
      inputTokens: 900,
      costUsd: 0.2,
    });
  });

  it("writes nothing with the audit flag off", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    await runDream({ sdkSessionId: "thread-1", ownerEmail: "alice@example.com", transcript: "text" });

    expect(listUsageRows(db, PERIOD)).toEqual([]);
  });

  it("still commits when the ledger write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getDbThrows = true;

    await expect(
      runDream({ sdkSessionId: "thread-1", ownerEmail: "alice@example.com", transcript: "text" }),
    ).resolves.toBe("committed");
  });
});

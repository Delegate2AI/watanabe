import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

type QueryOpts = { prompt: string; options: Options };

let fakeAgent: (opts: QueryOpts) => AsyncGenerator<unknown> = async function* () {};
const queryMock = vi.fn((opts: QueryOpts) => fakeAgent(opts));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return { ...actual, query: (opts: QueryOpts) => queryMock(opts) };
});

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
const { reviewStagedDiff } = await import("./agents");

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const saved = { ...process.env };

let counter = 0;

function resultMessage() {
  counter += 1;
  return {
    type: "result",
    subtype: "success",
    duration_ms: 2000,
    duration_api_ms: 1900,
    is_error: false,
    num_turns: 1,
    result: "{}",
    stop_reason: null,
    total_cost_usd: 0.05,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      "claude-opus-4-8": {
        inputTokens: 300,
        outputTokens: 30,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.05,
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    },
    permission_denials: [],
    uuid: `quality-result-${counter}`,
    session_id: "agent",
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  getDbThrows = false;
  counter = 0;
  process.env.USAGE_AUDIT_ENABLED = "1";
  process.env.QUALITY_GATES_ENABLED = "1";
  process.env.INTEGRITY_ENABLED = "0";
  fakeAgent = async function* () {
    yield resultMessage();
  };
});

afterEach(() => {
  process.env = { ...saved };
  queryMock.mockClear();
  vi.restoreAllMocks();
});

describe("reviewStagedDiff usage capture", () => {
  it("attributes both judgment agents to the submitting thread's owner", async () => {
    recordThread(db, "thread-1", "alice@example.com", "KB proposal");

    await reviewStagedDiff("+a staged line", undefined, "thread-1");

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ source: "quality", ownerEmail: "alice@example.com", threadId: "thread-1" });
    }
  });

  it("records the run as system spend when no thread id reaches it", async () => {
    await reviewStagedDiff("+a staged line");

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: "quality", ownerEmail: null, threadId: null });
  });

  it("keeps the never-throws contract when the ledger write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getDbThrows = true;

    await expect(reviewStagedDiff("+a staged line", undefined, "thread-1")).resolves.toEqual([]);
  });

  it("writes nothing with the audit flag off", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    await reviewStagedDiff("+a staged line", undefined, "thread-1");

    expect(listUsageRows(db, PERIOD)).toEqual([]);
  });
});

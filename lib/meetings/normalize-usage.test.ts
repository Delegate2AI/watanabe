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
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { openDb } = await import("@/lib/db/client");
const { listUsageRows } = await import("@/lib/db/usage-queries");
const { normalizeMeeting } = await import("./normalize");

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const saved = { ...process.env };

const MEETING = {
  id: "m1",
  title: "Weekly sync",
  startAt: "2026-09-07T09:00:00.000Z",
  endAt: "2026-09-07T09:30:00.000Z",
  attendees: [{ email: "alice@example.com", name: "Alice" }],
  transcript: { text: "Alice: hello." },
};

function resultMessage() {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 3000,
    duration_api_ms: 2900,
    is_error: false,
    num_turns: 1,
    result: "## Summary\n\nA sync.",
    stop_reason: null,
    total_cost_usd: 0.09,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      "claude-opus-4-8": {
        inputTokens: 500,
        outputTokens: 60,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.09,
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    },
    permission_denials: [],
    uuid: "meeting-result-1",
    session_id: "normalizer",
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.USAGE_AUDIT_ENABLED = "1";
  fakeAgent = async function* () {
    yield resultMessage();
  };
});

afterEach(() => {
  process.env = { ...saved };
  queryMock.mockClear();
  vi.restoreAllMocks();
});

describe("meeting normalizer usage capture", () => {
  it("records the run as system spend under the meetings source", async () => {
    await normalizeMeeting(MEETING as never);

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "meetings",
      ownerEmail: null,
      threadId: null,
      inputTokens: 500,
      costUsd: 0.09,
    });
  });

  it("writes nothing with the audit flag off", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    await normalizeMeeting(MEETING as never);

    expect(listUsageRows(db, PERIOD)).toEqual([]);
  });
});

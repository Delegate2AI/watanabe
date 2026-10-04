import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));
vi.mock("@/lib/agent/auth", () => ({ resolveAgentEnv: () => ({}) }));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { openDb } = await import("@/lib/db/client");
const { listUsageRows } = await import("@/lib/db/usage-queries");
const { previewDesignGuide } = await import("./preview");

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const PAGE = "<!doctype html><html><head><title>T</title></head><body><h1>T</h1></body></html>";
const saved = { ...process.env };

function sdkResult(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "result",
        subtype: "success",
        result: text,
        duration_ms: 5000,
        duration_api_ms: 4800,
        is_error: false,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0.11,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {
          "claude-opus-4-8": {
            inputTokens: 700,
            outputTokens: 900,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.11,
            contextWindow: 200000,
            maxOutputTokens: 64000,
          },
        },
        permission_denials: [],
        uuid: "design-result-1",
        session_id: "design-preview",
      };
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.USAGE_AUDIT_ENABLED = "1";
  queryMock.mockReset().mockReturnValue(sdkResult(PAGE));
});

afterEach(() => {
  process.env = { ...saved };
  vi.clearAllMocks();
});

describe("design preview usage capture", () => {
  it("records the run as system spend under the design source", async () => {
    await previewDesignGuide("A candidate house style.");

    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "design",
      ownerEmail: null,
      threadId: null,
      model: "claude-opus-4-8",
      inputTokens: 700,
      outputTokens: 900,
      costUsd: 0.11,
      ok: true,
    });
  });

  it("still returns the rendered document", async () => {
    const result = await previewDesignGuide("A candidate house style.");

    expect(result.ok).toBe(true);
  });

  it("writes nothing with the audit flag off", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    await previewDesignGuide("A candidate house style.");

    expect(listUsageRows(db, PERIOD)).toEqual([]);
  });
});

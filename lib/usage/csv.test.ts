import { describe, expect, it } from "vitest";
import { usageCsv } from "./csv";
import type { UsageRow } from "./types";

const ROW: UsageRow = {
  id: "u1",
  resultId: "r1",
  at: "2026-09-07T10:00:00.000Z",
  source: "chat",
  ownerEmail: "alice@example.com",
  threadId: "thread-1",
  model: "claude-opus-4-8",
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 5,
  cacheCreationTokens: 7,
  costUsd: 0.25,
  durationMs: 1800,
  ok: true,
};

describe("usageCsv", () => {
  it("writes a header and one line per row", () => {
    const lines = usageCsv([ROW]).trimEnd().split("\n");

    expect(lines[0]).toBe(
      "at,source,owner_email,thread_id,model,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd,duration_ms,ok,result_id",
    );
    expect(lines[1]).toBe(
      "2026-09-07T10:00:00.000Z,chat,alice@example.com,thread-1,claude-opus-4-8,100,20,5,7,0.25,1800,1,r1",
    );
  });

  it("renders a null owner as an empty cell and a failed row as zero", () => {
    const line = usageCsv([{ ...ROW, ownerEmail: null, threadId: null, ok: false }]).trimEnd().split("\n")[1];

    expect(line).toBe("2026-09-07T10:00:00.000Z,chat,,,claude-opus-4-8,100,20,5,7,0.25,1800,0,r1");
  });

  it("quotes a value carrying a comma or a quote", () => {
    const line = usageCsv([{ ...ROW, model: 'weird,"model' }]).trimEnd().split("\n")[1];

    expect(line).toContain('"weird,""model"');
  });

  it("writes a header even with no rows", () => {
    expect(usageCsv([]).trimEnd().split("\n")).toHaveLength(1);
  });
});

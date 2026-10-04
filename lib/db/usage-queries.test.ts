import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { recordThread } from "./threads";
import { recordUsage } from "./usage";
import { listOwnerThreads, listUsageRows, summarizeUsage, USAGE_EXPORT_LIMIT } from "./usage-queries";
import type { UsageEvent } from "@/lib/usage/types";

let db: DatabaseType;

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

function event(overrides: Partial<UsageEvent> & { resultId: string }): UsageEvent {
  return {
    at: "2026-09-10T09:00:00.000Z",
    source: "chat",
    ownerEmail: "alice@example.com",
    threadId: "thread-a",
    model: "claude-opus-4-8",
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 1,
    cacheCreationTokens: 3,
    costUsd: 1,
    durationMs: 100,
    ok: true,
    ...overrides,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("summarizeUsage", () => {
  it("splits owned rows from system rows and counts a two-model result as one turn", () => {
    recordUsage(db, [
      event({ resultId: "r1" }),
      event({ resultId: "r1", model: "claude-haiku-4-5", costUsd: 0.5, inputTokens: 4 }),
      event({ resultId: "r2", source: "meetings", ownerEmail: null, threadId: null, costUsd: 2 }),
    ]);

    const summary = summarizeUsage(db, PERIOD);

    expect(summary.users).toMatchObject({ turns: 1, costUsd: 1.5, inputTokens: 14 });
    expect(summary.system).toMatchObject({ turns: 1, costUsd: 2 });
    expect(summary.grand).toMatchObject({ turns: 2, costUsd: 3.5 });
  });

  it("names each owner's most expensive model and sorts owners by cost", () => {
    recordUsage(db, [
      event({ resultId: "r1", ownerEmail: "alice@example.com", costUsd: 1 }),
      event({ resultId: "r2", ownerEmail: "alice@example.com", model: "claude-haiku-4-5", costUsd: 3 }),
      event({ resultId: "r3", ownerEmail: "bob@example.com", costUsd: 2 }),
    ]);

    const summary = summarizeUsage(db, PERIOD);

    expect(summary.owners.map((row) => row.ownerEmail)).toEqual(["alice@example.com", "bob@example.com"]);
    expect(summary.owners[0]).toMatchObject({ turns: 2, costUsd: 4, topModel: "claude-haiku-4-5" });
    expect(summary.owners[1]).toMatchObject({ turns: 1, topModel: "claude-opus-4-8" });
  });

  it("reports the system split by source and the whole period by model", () => {
    recordUsage(db, [
      event({ resultId: "r1", source: "packages", ownerEmail: null, threadId: null, costUsd: 1 }),
      event({ resultId: "r2", source: "design", ownerEmail: null, threadId: null, costUsd: 3 }),
      event({ resultId: "r3", costUsd: 5, model: "claude-haiku-4-5" }),
    ]);

    const summary = summarizeUsage(db, PERIOD);

    expect(summary.sources.map((row) => row.source)).toEqual(["design", "packages"]);
    expect(summary.models.map((row) => row.model)).toEqual(["claude-haiku-4-5", "claude-opus-4-8"]);
    expect(summary.models[0]).toMatchObject({ turns: 1, costUsd: 5 });
  });

  it("includes the whole of the last day and excludes the day after", () => {
    recordUsage(db, [
      event({ resultId: "before", at: "2026-08-31T23:59:59.999Z", costUsd: 100 }),
      event({ resultId: "first", at: "2026-09-01T00:00:00.000Z" }),
      event({ resultId: "last", at: "2026-09-30T23:59:59.999Z" }),
      event({ resultId: "after", at: "2026-10-01T00:00:00.000Z", costUsd: 100 }),
    ]);

    expect(summarizeUsage(db, PERIOD).grand).toMatchObject({ turns: 2, costUsd: 2 });
  });

  it("answers an empty period with zeros rather than nulls", () => {
    const summary = summarizeUsage(db, PERIOD);

    expect(summary.grand).toEqual({
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    });
    expect(summary.owners).toEqual([]);
    expect(summary).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("listOwnerThreads", () => {
  it("groups by thread and source, joins the title, and keeps a deleted thread on the books", () => {
    recordThread(db, "thread-a", "alice@example.com", "Pricing memo", "2026-09-10T09:00:00.000Z");
    recordUsage(db, [
      event({ resultId: "r1" }),
      event({ resultId: "r2", at: "2026-09-11T09:00:00.000Z" }),
      event({ resultId: "r3", source: "dream", costUsd: 0.5 }),
      event({ resultId: "r4", threadId: "thread-gone", costUsd: 7 }),
    ]);

    const rows = listOwnerThreads(db, "alice@example.com", PERIOD);

    expect(rows[0]).toMatchObject({ threadId: "thread-gone", title: null, source: "chat", turns: 1, costUsd: 7 });
    expect(rows[1]).toMatchObject({ threadId: "thread-a", title: "Pricing memo", source: "chat", turns: 2, costUsd: 2 });
    expect(rows[1].lastAt).toBe("2026-09-11T09:00:00.000Z");
    expect(rows[2]).toMatchObject({ source: "dream", turns: 1, costUsd: 0.5 });
  });

  it("never returns another person's threads", () => {
    recordUsage(db, [event({ resultId: "r1", ownerEmail: "bob@example.com" })]);

    expect(listOwnerThreads(db, "alice@example.com", PERIOD)).toEqual([]);
  });
});

describe("listUsageRows", () => {
  it("returns rows oldest first and caps the export", () => {
    recordUsage(db, [
      event({ resultId: "r2", at: "2026-09-11T09:00:00.000Z" }),
      event({ resultId: "r1", at: "2026-09-10T09:00:00.000Z" }),
    ]);

    const rows = listUsageRows(db, PERIOD);

    expect(rows.map((row) => row.resultId)).toEqual(["r1", "r2"]);
    expect(rows[0]).toMatchObject({ source: "chat", ok: true, ownerEmail: "alice@example.com" });
    expect(rows[0].id).toEqual(expect.any(String));
    expect(USAGE_EXPORT_LIMIT).toBe(50000);
    expect(listUsageRows(db, PERIOD, 1)).toHaveLength(1);
  });
});

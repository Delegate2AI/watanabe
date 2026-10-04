import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/memory/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/config")>();
  return { ...actual, memoryWorktreeDir: () => path.join(os.tmpdir(), "usage-service-no-roles") };
});

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/roles")>();
  return { ...actual, can: (...args: unknown[]) => canMock(...args) };
});

const { openDb } = await import("@/lib/db/client");
const { recordUsage } = await import("@/lib/db/usage");
const { actorFor } = await import("@/lib/service/actor");
const { exportUsage, listOwnerThreads, summarizeUsage } = await import("./usage");

const GROUPS = { admins: ["admin@example.com"], exec: ["alice@example.com"] };
const saved = { ...process.env };

let db: import("better-sqlite3").Database;

function ctx(email = "admin@example.com") {
  return { db, actor: actorFor(email, GROUPS) };
}

beforeEach(() => {
  db = openDb(":memory:");
  canMock.mockReset().mockReturnValue(true);
  process.env.USAGE_AUDIT_ENABLED = "1";
  recordUsage(db, [
    {
      resultId: "r1",
      at: "2026-09-07T10:00:00.000Z",
      source: "chat",
      ownerEmail: "alice@example.com",
      threadId: "thread-1",
      model: "claude-opus-4-8",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.5,
      durationMs: 900,
      ok: true,
    },
  ]);
});

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("summarizeUsage", () => {
  it("answers not_found with the flag off, before authorizing", () => {
    process.env.USAGE_AUDIT_ENABLED = "0";
    canMock.mockReturnValue(false);

    expect(summarizeUsage(ctx(), { from: "nonsense" })).toEqual({ ok: false, code: "not_found" });
  });

  it("refuses a caller without manageAccess before it parses", () => {
    canMock.mockReturnValue(false);

    expect(summarizeUsage(ctx("alice@example.com"), { from: "nonsense" })).toEqual({
      ok: false,
      code: "needs_role",
    });
  });

  it("refuses a malformed date", () => {
    expect(summarizeUsage(ctx(), { from: "2026-13-40", to: "2026-09-07" })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "from",
    });
  });

  it("refuses a period whose end precedes its start", () => {
    expect(summarizeUsage(ctx(), { from: "2026-09-07", to: "2026-09-01" })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "to",
    });
  });

  it("summarizes the requested period", () => {
    const result = summarizeUsage(ctx(), { from: "2026-09-01", to: "2026-09-30" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grand).toMatchObject({ turns: 1, costUsd: 1.5 });
    expect(result.value.owners[0]).toMatchObject({ ownerEmail: "alice@example.com", topModel: "claude-opus-4-8" });
  });

  it("defaults to the thirty days ending today when no period is given", () => {
    const result = summarizeUsage(ctx(), {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.value.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("listOwnerThreads", () => {
  it("requires an owner", () => {
    expect(listOwnerThreads(ctx(), { from: "2026-09-01", to: "2026-09-30" })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "owner",
    });
  });

  it("returns that owner's threads", () => {
    const result = listOwnerThreads(ctx(), {
      owner: "alice@example.com",
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.owner).toBe("alice@example.com");
    expect(result.value.threads[0]).toMatchObject({ threadId: "thread-1", turns: 1, costUsd: 1.5 });
  });
});

describe("exportUsage", () => {
  it("names the file after the period and carries one line per row", () => {
    const result = exportUsage(ctx(), { from: "2026-09-01", to: "2026-09-30" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe("usage-2026-09-01-2026-09-30.csv");
    expect(result.value.csv.trimEnd().split("\n")).toHaveLength(2);
  });

  it("refuses a caller without manageAccess", () => {
    canMock.mockReturnValue(false);

    expect(exportUsage(ctx(), { from: "2026-09-01", to: "2026-09-30" })).toEqual({
      ok: false,
      code: "needs_role",
    });
  });
});

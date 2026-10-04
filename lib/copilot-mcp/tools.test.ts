import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertSharedDoc, addVersion } from "@/lib/db/shared-docs";
import { upsertShare } from "@/lib/db/shared-doc-shares";
import { createThread } from "@/lib/db/comment-threads";
import { listSuggestions } from "@/lib/db/suggestions";
import { copilotRead, copilotReviewState, copilotSuggest, type CopilotToolContext } from "./tools";

let db: DatabaseType;

const BODY = "# Plan\n\nThe old figure is wrong. The plan is sound.\n";
const OWNER = "alice@example.com";
const REVIEWER = "bob@example.com";

function ctx(overrides: Partial<CopilotToolContext> = {}): CopilotToolContext {
  return { db, docId: "d1", ownerEmail: REVIEWER, ...overrides };
}

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: OWNER, body: BODY });
  insertSharedDoc(db, { id: "d2", title: "Other", ownerEmail: OWNER, body: "Second doc body." });
  upsertShare(db, "d1", REVIEWER, "comment");
});

describe("copilotRead", () => {
  it("returns the latest body, version, and the caller's tier", () => {
    addVersion(db, "d1", OWNER, BODY + "\nMore.\n");
    const outcome = copilotRead(ctx());
    expect(outcome).toMatchObject({
      ok: true,
      result: { title: "Plan", version: 2, format: "md", yourAccess: "comment" },
    });
    if (outcome.ok) expect(outcome.result.body).toContain("More.");
  });

  it("fails closed for a caller whose share was revoked, same as a missing doc", () => {
    const gone = copilotRead(ctx({ ownerEmail: "stranger@example.com" }));
    const missing = copilotRead(ctx({ docId: "00000000-0000-0000-0000-000000000000" }));
    expect(gone.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!gone.ok && !missing.ok) expect(gone.error).toBe(missing.error);
  });
});

describe("copilotReviewState", () => {
  it("lists open threads and pending suggestions only", () => {
    createThread(db, {
      id: "t1", docId: "d1", anchor: null, createdBy: OWNER,
      createdAt: "2026-08-27T10:00:00Z", body: "Please tighten this.", messageId: "m1",
    });
    const filed = copilotSuggest(ctx(), { quote: "old figure", proposedText: "new figure" });
    expect(filed.ok).toBe(true);
    const outcome = copilotReviewState(ctx());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.openThreads).toHaveLength(1);
      expect(outcome.result.openThreads[0].messages[0].body).toBe("Please tighten this.");
      expect(outcome.result.pendingSuggestions).toHaveLength(1);
      expect(outcome.result.pendingSuggestions[0].via).toBe("copilot");
    }
  });
});

describe("copilotSuggest", () => {
  it("files a pending suggestion attributed to the acting user via copilot", () => {
    const outcome = copilotSuggest(ctx(), { quote: "old figure", proposedText: "new figure", note: "stale number" });
    expect(outcome).toMatchObject({ ok: true, result: { baseVersion: 1 } });
    const [s] = listSuggestions(db, "d1");
    expect(s.createdBy).toBe(REVIEWER);
    expect(s.via).toBe("copilot");
    expect(s.note).toBe("stale number");
  });

  it("names the occurrence count on an ambiguous quote and files nothing", () => {
    const outcome = copilotSuggest(ctx(), { quote: "The ", proposedText: "A " });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("2 times");
    expect(listSuggestions(db, "d1")).toHaveLength(0);
  });

  it("points at copilot_read when the quote is absent", () => {
    const outcome = copilotSuggest(ctx(), { quote: "never in this doc", proposedText: "x" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("copilot_read");
  });

  it("cannot reach a second document: the binding is the closure", () => {
    // The reviewer has no share on d2, so the same call against a d2-bound
    // context fails closed; and a d1-bound context can never write to d2.
    const outcome = copilotSuggest(ctx({ docId: "d2" }), { quote: "Second doc", proposedText: "x" });
    expect(outcome.ok).toBe(false);
    expect(listSuggestions(db, "d2")).toHaveLength(0);
  });

  it("fails closed when access is revoked between calls", () => {
    expect(copilotSuggest(ctx(), { quote: "old figure", proposedText: "y" }).ok).toBe(true);
    db.prepare(`DELETE FROM doc_shares WHERE doc_id = 'd1'`).run();
    const after = copilotSuggest(ctx(), { quote: "plan is sound", proposedText: "z" });
    expect(after.ok).toBe(false);
    expect(listSuggestions(db, "d1")).toHaveLength(1);
  });
});

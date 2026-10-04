import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertSharedDoc, addVersion } from "@/lib/db/shared-docs";
import { listSuggestions } from "@/lib/db/suggestions";
import { createAnchor } from "./anchor";
import { proposeSuggestion, proposeSuggestionFromQuote } from "./propose-suggestion";

let db: DatabaseType;

const BODY = "# Plan\n\nThe old figure is wrong. The plan is sound.\n";

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: "alice@example.com", body: BODY });
});

describe("proposeSuggestionFromQuote", () => {
  it("locates a unique quote, stamps the current baseVersion, and records via", () => {
    addVersion(db, "d1", "alice@example.com", BODY + "\nMore.\n");
    const outcome = proposeSuggestionFromQuote(db, {
      docId: "d1", quote: "old figure", proposedText: "new figure",
      note: null, createdBy: "bob@example.com", via: "copilot",
    });
    expect(outcome).toMatchObject({ ok: true, baseVersion: 2 });
    const [s] = listSuggestions(db, "d1");
    expect(s.originalText).toBe("old figure");
    expect(s.proposedText).toBe("new figure");
    expect(s.via).toBe("copilot");
    expect(s.createdBy).toBe("bob@example.com");
    expect(s.status).toBe("pending");
  });

  it("refuses an ambiguous quote, naming the occurrence count", () => {
    const outcome = proposeSuggestionFromQuote(db, {
      docId: "d1", quote: "The ", proposedText: "A ",
      note: null, createdBy: "bob@example.com", via: "copilot",
    });
    expect(outcome).toEqual({ ok: false, reason: "anchor", matches: 2 });
    expect(listSuggestions(db, "d1")).toHaveLength(0);
  });

  it("refuses an absent quote with matches: 0", () => {
    const outcome = proposeSuggestionFromQuote(db, {
      docId: "d1", quote: "not in the document", proposedText: "x",
      note: null, createdBy: "bob@example.com", via: "copilot",
    });
    expect(outcome).toEqual({ ok: false, reason: "anchor", matches: 0 });
  });
});

describe("proposeSuggestion (anchor path)", () => {
  it("accepts a matching anchor and stores a human row with via null", () => {
    const start = BODY.indexOf("old figure");
    const anchor = createAnchor(BODY, start, start + "old figure".length);
    const outcome = proposeSuggestion(db, {
      docId: "d1", anchor, proposedText: "new figure",
      note: "typo", createdBy: "bob@example.com", via: null,
    });
    expect(outcome).toMatchObject({ ok: true, baseVersion: 1 });
    const [s] = listSuggestions(db, "d1");
    expect(s.via).toBeNull();
    expect(s.note).toBe("typo");
  });

  it("refuses an anchor whose quote no longer matches the body", () => {
    const anchor = createAnchor("something else entirely", 0, 9);
    const outcome = proposeSuggestion(db, {
      docId: "d1", anchor, proposedText: "x",
      note: null, createdBy: "bob@example.com", via: null,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "anchor" });
  });
});

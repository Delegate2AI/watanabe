import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertSharedDoc } from "./shared-docs";
import { createSuggestion, listSuggestions, getSuggestion, setSuggestionStatus } from "./suggestions";
import type { TextAnchor } from "@/lib/shared-docs/types";

let db: DatabaseType;
const A: TextAnchor = { quote: "v1", prefix: "# ", suffix: "", start: 2 };

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "P", ownerEmail: "a@x.com", body: "# v1" }, "2026-07-11T00:00:00.000Z");
});

function seed(id = "s1") {
  createSuggestion(db, {
    id, docId: "d1", baseVersion: 1, anchor: A, originalText: "v1", proposedText: "v2",
    note: "clearer", createdBy: "b@x.com", createdAt: "2026-07-11T00:01:00.000Z",
  });
}

describe("suggestions", () => {
  it("creates and lists a pending suggestion", () => {
    seed();
    const list = listSuggestions(db, "d1");
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("pending");
    expect(list[0].proposedText).toBe("v2");
    expect(list[0].anchor).toEqual(A);
  });

  it("reads one by id", () => {
    seed();
    expect(getSuggestion(db, "s1")?.note).toBe("clearer");
    expect(getSuggestion(db, "nope")).toBeNull();
  });

  it("records acceptance with applied version", () => {
    seed();
    expect(setSuggestionStatus(db, "s1", "accepted", "a@x.com", "2026-07-11T00:05:00.000Z", 2)).toBe(true);
    const s = getSuggestion(db, "s1")!;
    expect(s.status).toBe("accepted");
    expect(s.resolvedBy).toBe("a@x.com");
    expect(s.appliedVersion).toBe(2);
  });

  it("only transitions a pending suggestion: a second call on an already-resolved row changes nothing and returns false", () => {
    seed();
    expect(setSuggestionStatus(db, "s1", "accepted", "a@x.com", "2026-07-11T00:05:00.000Z", 2)).toBe(true);
    // A second, concurrent decision (e.g. a racing reject) must not overwrite
    // the first one: the conditional UPDATE only ever moves a row OUT of
    // pending, so once resolved it is immutable through this function.
    expect(setSuggestionStatus(db, "s1", "rejected", "b@x.com", "2026-07-11T00:06:00.000Z", null)).toBe(false);
    const s = getSuggestion(db, "s1")!;
    expect(s.status).toBe("accepted");
    expect(s.resolvedBy).toBe("a@x.com");
    expect(s.appliedVersion).toBe(2);
  });
});

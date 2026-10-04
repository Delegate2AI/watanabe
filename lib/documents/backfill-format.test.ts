import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread } from "@/lib/db/threads";
import { createDoc } from "@/lib/db/chat-docs";
import { insertArtifact } from "@/lib/db/artifacts";
import { insertSharedDoc } from "@/lib/db/shared-docs";
import { backfillDocuments } from "./backfill";

/**
 * The unified-documents backfill carries the format
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The backfill copies version rows with explicit column lists. A list written
 * before `format` existed does not fail, it takes the destination default, so
 * every HTML version silently arrives labelled markdown. That is the quietest
 * possible data loss: the rows are all there and every one of them is wrong.
 */

const OWNER = "alice@example.com";
const THREAD = "thread-1";
const HTML = "<h1>Designed</h1>";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  recordThread(db, THREAD, OWNER, "chat");
});

function formatOfDocument(id: string): unknown {
  return db.prepare(`SELECT format FROM document_versions WHERE doc_id = @id ORDER BY version ASC`).all({ id });
}

describe("backfillDocuments carries the format", () => {
  it("keeps an html chat document html", () => {
    createDoc(db, { id: "cd1", threadId: THREAD, ownerEmail: OWNER, title: "D", body: HTML, format: "html" });
    backfillDocuments(db);
    expect(formatOfDocument("cd1")).toEqual([{ format: "html" }]);
  });

  it("keeps an html artifact html", () => {
    insertArtifact(db, { id: "a1", title: "A", ownerEmail: OWNER, body: HTML, format: "html" });
    backfillDocuments(db);
    expect(formatOfDocument("a1")).toEqual([{ format: "html" }]);
  });

  it("keeps an html shared doc html", () => {
    insertSharedDoc(db, { id: "s1", title: "S", ownerEmail: OWNER, body: HTML, format: "html" });
    backfillDocuments(db);
    expect(formatOfDocument("s1")).toEqual([{ format: "html" }]);
  });

  it("leaves markdown as markdown, which is every row that exists today", () => {
    createDoc(db, { id: "cd2", threadId: THREAD, ownerEmail: OWNER, title: "D", body: "# plain" });
    backfillDocuments(db);
    expect(formatOfDocument("cd2")).toEqual([{ format: "md" }]);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread } from "@/lib/db/threads";
import { createDoc, addVersion } from "@/lib/db/chat-docs";
import { promote, updateTarget } from "./promote";

/**
 * Format survives promotion (spec 2026-08-20-html-documents-and-export-design).
 *
 * Promotion copies a chat document's body into an artifact or a shared doc. If
 * it carries the body without the format, the copy takes the column default and
 * an HTML page becomes a row labelled markdown. That is worse than losing it:
 * the artifact publish path writes an artifact body verbatim into `docs/*.md`,
 * so a mislabelled row is model-authored HTML on its way into the vault as if it
 * were prose.
 */

const OWNER = "alice@example.com";
const THREAD = "thread-1";
const HTML = "<h1>Designed</h1><p>body</p>";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  recordThread(db, THREAD, OWNER, "chat");
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.SHARED_DOCS_ENABLED = "1";
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
});

function htmlDoc(id: string): void {
  createDoc(db, { id, threadId: THREAD, ownerEmail: OWNER, title: "Designed", body: HTML, format: "html" });
}

function formatOf(table: string, fk: string, id: string): unknown {
  return db.prepare(`SELECT format FROM ${table} WHERE ${fk} = @id ORDER BY version DESC LIMIT 1`).get({ id });
}

describe("promotion carries the document format", () => {
  it("promotes an html chat document to an html artifact", () => {
    htmlDoc("d1");
    const result = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatOf("artifact_versions", "artifact_id", result.targetId)).toEqual({ format: "html" });
  });

  it("promotes an html chat document to an html shared doc", () => {
    htmlDoc("d2");
    const result = promote(db, { docId: "d2", ownerEmail: OWNER, target: "shared_doc" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatOf("shared_doc_versions", "doc_id", result.targetId)).toEqual({ format: "html" });
  });

  it("leaves a markdown document as markdown, which is every existing promotion", () => {
    createDoc(db, { id: "d3", threadId: THREAD, ownerEmail: OWNER, title: "Plain", body: "# plain" });
    const result = promote(db, { docId: "d3", ownerEmail: OWNER, target: "artifact" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatOf("artifact_versions", "artifact_id", result.targetId)).toEqual({ format: "md" });
  });

  it("carries the format on an Update too, not only on the first promotion", () => {
    createDoc(db, { id: "d4", threadId: THREAD, ownerEmail: OWNER, title: "Plain", body: "# plain" });
    const promoted = promote(db, { docId: "d4", ownerEmail: OWNER, target: "artifact" });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;

    addVersion(db, "d4", OWNER, HTML, { format: "html" });
    const updated = updateTarget(db, { docId: "d4", ownerEmail: OWNER, target: "artifact" });

    expect(updated.ok).toBe(true);
    expect(formatOf("artifact_versions", "artifact_id", promoted.targetId)).toEqual({ format: "html" });
  });
});

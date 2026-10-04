import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread } from "@/lib/db/threads";
import { getVersions, latestVersion } from "@/lib/db/chat-docs";
import { docWrite } from "./tools";

/**
 * `doc_write` with a `format`
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The refusals here matter more than the happy path. An unrecognised format
 * must not be coerced to markdown, because the coercion is silent and the
 * result is an empty document rather than a visibly wrong one. And a format the
 * flag has not switched on must be refused rather than stored, so that turning
 * the flag off is a real fall-back and not a renderer that suddenly cannot read
 * rows already in the table.
 */

let db: DatabaseType;
const OWNER = "alice@example.com";
const THREAD = "thread-1";

function ctx() {
  return { db, getThreadId: () => THREAD, ownerEmail: OWNER };
}

beforeEach(() => {
  db = openDb(":memory:");
  recordThread(db, THREAD, OWNER, "chat");
  process.env.HTML_DOCUMENTS_ENABLED = "1";
});

afterEach(() => {
  delete process.env.HTML_DOCUMENTS_ENABLED;
});

describe("doc_write format", () => {
  it("writes markdown when no format is named, which is every existing caller", () => {
    const out = docWrite(ctx(), { title: "Memo", body: "# Memo" });
    expect(out.format).toBe("md");
    expect(latestVersion(db, out.docId, OWNER)).toMatchObject({ format: "md" });
  });

  it("writes html when asked for it", () => {
    const out = docWrite(ctx(), { title: "Report", body: "<h1>Report</h1>", format: "html" });
    expect(out.format).toBe("html");
    expect(latestVersion(db, out.docId, OWNER)).toMatchObject({ format: "html", body: "<h1>Report</h1>" });
  });

  it("refuses an unrecognised format instead of quietly storing it as markdown", () => {
    expect(() =>
      docWrite(ctx(), { body: "x", format: "pdf" as unknown as "html" }),
    ).toThrow(/format/i);
  });

  it("writes nothing at all when the format is refused", () => {
    const first = docWrite(ctx(), { title: "Memo", body: "v1" });
    expect(() =>
      docWrite(ctx(), { body: "v2", docId: first.docId, format: "docx" as unknown as "html" }),
    ).toThrow();
    expect(getVersions(db, first.docId, OWNER)).toHaveLength(1);
  });

  it("lets a revision move a document from markdown to html", () => {
    const first = docWrite(ctx(), { title: "Memo", body: "# plain" });
    const second = docWrite(ctx(), { body: "<h1>designed</h1>", docId: first.docId, format: "html" });

    expect(second.version).toBe(2);
    expect(getVersions(db, first.docId, OWNER).map((v) => v.format)).toEqual(["md", "html"]);
  });

  it("derives a title from html without leaving tags in it", () => {
    const out = docWrite(ctx(), { body: "<h1>Quarterly Review</h1><p>text</p>", format: "html" });
    expect(out.title).toBe("Quarterly Review");
  });

  describe("with the flag off", () => {
    beforeEach(() => {
      process.env.HTML_DOCUMENTS_ENABLED = "0";
    });

    it("refuses html, so flag-off is a real fall-back and not a half-written table", () => {
      expect(() => docWrite(ctx(), { body: "<h1>x</h1>", format: "html" })).toThrow(/format/i);
      expect(() => docWrite(ctx(), { body: "<h1>x</h1>", format: "html" })).toThrow(/not enabled|unavailable/i);
    });

    it("still writes markdown exactly as it does today", () => {
      const out = docWrite(ctx(), { title: "Memo", body: "# Memo" });
      expect(out.format).toBe("md");
      expect(latestVersion(db, out.docId, OWNER)).toMatchObject({ format: "md" });
    });
  });
});

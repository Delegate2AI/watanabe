import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { createDoc, addVersion, getVersions, latestVersion } from "./chat-docs";

/**
 * The `format` a chat document version was written as, carried end to end
 * through the store (spec 2026-08-20-html-documents-and-export-design).
 *
 * The reason this needs its own coverage rather than riding on chat-docs.test.ts:
 * a body whose format is lost is not degraded, it is GONE. The markdown renderer
 * sets `proseSkipHtml`, which discards raw HTML instead of printing it, so an
 * HTML body read back as markdown renders as an empty document.
 */

const OWNER = "alice@example.com";
const THREAD = "thread-1";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  db.prepare(
    `INSERT INTO threads (sdk_session_id, owner_email, title, created_at, updated_at)
     VALUES (@t, @o, 'A thread', @at, @at)`,
  ).run({ t: THREAD, o: OWNER, at: "2026-08-20T00:00:00Z" });
});

function newDoc(id: string, body: string, format?: "md" | "html"): boolean {
  return createDoc(db, { id, threadId: THREAD, ownerEmail: OWNER, title: "Doc", body, format });
}

describe("chat document format", () => {
  it("defaults to markdown when the caller names none, so nothing about today changes", () => {
    newDoc("d1", "# heading");
    expect(getVersions(db, "d1", OWNER)).toEqual([
      expect.objectContaining({ version: 1, body: "# heading", format: "md" }),
    ]);
  });

  it("stores an html document as html", () => {
    newDoc("d2", "<h1>heading</h1>", "html");
    expect(getVersions(db, "d2", OWNER)[0]).toMatchObject({ format: "html" });
  });

  it("reports the format on the latest version, which is what a renderer reads", () => {
    newDoc("d3", "<h1>a</h1>", "html");
    expect(latestVersion(db, "d3", OWNER)).toMatchObject({ version: 1, format: "html" });
  });

  it("lets a revision change the format and leaves the earlier version as it was", () => {
    newDoc("d4", "# plain", "md");
    expect(addVersion(db, "d4", OWNER, "<h1>designed</h1>", { format: "html" })).toBe(2);

    const versions = getVersions(db, "d4", OWNER);
    expect(versions.map((v) => [v.version, v.format])).toEqual([
      [1, "md"],
      [2, "html"],
    ]);
    expect(latestVersion(db, "d4", OWNER)).toMatchObject({ format: "html" });
  });

  it("defaults a revision to markdown when the caller names none", () => {
    newDoc("d5", "# plain");
    addVersion(db, "d5", OWNER, "# still plain");
    expect(getVersions(db, "d5", OWNER)[1]).toMatchObject({ version: 2, format: "md" });
  });
});

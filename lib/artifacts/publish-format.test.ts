import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertArtifact, updateArtifact } from "@/lib/db/artifacts";
import { publishArtifact } from "./publish";

/**
 * Publishing must never put a raw HTML body into the vault as if it were prose
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * `publishCore` writes the artifact body verbatim into `docs/<path>.md`. A
 * designed HTML page written into a markdown note is model-authored markup
 * landing in the knowledge base, rendered by Quartz as either escaped tag soup
 * or nothing at all, and reviewed as a diff nobody can read.
 *
 * Section 7 of the spec has HTML publish as a two-file merge request (derived
 * `.md` plus the designed `.html`), which needs the renderer. Until a derived
 * markdown is actually available, the answer is a refusal, not a best effort:
 * the vault is the one place in this system a bad write is not undoable by its
 * author.
 */

const OWNER = "alice@example.com";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "0";
  process.env.REPO_WRITE_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.KB_WRITE_ENABLED;
  delete process.env.ROLES_ENABLED;
  delete process.env.REPO_WRITE_TOKEN;
  vi.restoreAllMocks();
});

function readyArtifact(id: string, format: "md" | "html"): void {
  insertArtifact(db, {
    id,
    title: "Quarterly review",
    ownerEmail: OWNER,
    body: format === "html" ? "<h1>Quarterly review</h1>" : "# Quarterly review",
    format,
  });
  updateArtifact(db, id, OWNER, {
    targetPath: "notes/quarterly-review.md",
    targetVisibility: ["all-hands"],
    status: "ready",
  });
}

describe("publishing a designed document", () => {
  it("refuses to publish an html artifact rather than writing markup into the vault", async () => {
    readyArtifact("a-html", "html");

    const result = await publishArtifact(db, { id: "a-html", ownerEmail: OWNER, ownerName: "Alice", mode: "mr" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
  });

  it("leaves the artifact unpublished when it refuses", async () => {
    readyArtifact("a-html2", "html");

    await publishArtifact(db, { id: "a-html2", ownerEmail: OWNER, ownerName: "Alice", mode: "mr" });

    const row = db.prepare(`SELECT status, published_note_path FROM artifacts WHERE id = 'a-html2'`).get();
    expect(row).toEqual({ status: "ready", published_note_path: null });
  });
});

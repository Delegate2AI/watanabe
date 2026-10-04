import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertArtifact, markPublished, updateArtifact } from "@/lib/db/artifacts";
import { findProposalOrigin } from "./review-enrichment";

const ALICE = "alice@example.com";
const MR_URL = "https://gl.example.com/g/p/-/merge_requests/7";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

function artifactInReview(id: string, iid: number, owner = ALICE): void {
  insertArtifact(db, { id, title: `Note ${id}`, ownerEmail: owner, body: "body" });
  updateArtifact(db, id, owner, { targetPath: `docs/notes/${id}.md`, status: "ready" });
  markPublished(db, id, owner, `docs/notes/${id}.md`, "in_review", { url: MR_URL, iid });
}

function sharedDocInReview(docId: string, owner = ALICE, mrUrl = MR_URL): void {
  const now = "2026-08-18T10:00:00.000Z";
  db.prepare(
    `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
     VALUES (@id, @title, @owner, @now, @now)`,
  ).run({ id: docId, title: `Doc ${docId}`, owner, now });
  db.prepare(
    `INSERT INTO shared_doc_publications
       (doc_id, status, target_path, target_visibility, published_note_path, mr_url, created_at, updated_at)
     VALUES (@id, 'in_review', 'docs/a.md', '["all-hands"]', NULL, @mrUrl, @now, @now)`,
  ).run({ id: docId, mrUrl, now });
}

describe("findProposalOrigin", () => {
  it("finds an artifact by its merge request iid", () => {
    artifactInReview("art1", 7);
    expect(findProposalOrigin(db, { iid: 7, webUrl: MR_URL })).toEqual({
      owner: ALICE,
      title: "Note art1",
      origin: "artifact",
    });
  });

  it("finds a shared doc by its merge request url, since that table stores no iid", () => {
    sharedDocInReview("doc1");
    expect(findProposalOrigin(db, { iid: 7, webUrl: MR_URL })).toEqual({
      owner: ALICE,
      title: "Doc doc1",
      origin: "shared-doc",
    });
  });

  it("prefers the artifact when both somehow point at the same merge request", () => {
    artifactInReview("art1", 7);
    sharedDocInReview("doc1");
    expect(findProposalOrigin(db, { iid: 7, webUrl: MR_URL })?.origin).toBe("artifact");
  });

  it("is null for a merge request neither table knows, which is every chat proposal", () => {
    artifactInReview("art1", 7);
    expect(findProposalOrigin(db, { iid: 99, webUrl: "https://gl.example.com/g/p/-/merge_requests/99" }))
      .toBeNull();
  });

  it("does not match a shared doc on a different merge request url", () => {
    sharedDocInReview("doc1", ALICE, "https://gl.example.com/g/p/-/merge_requests/3");
    expect(findProposalOrigin(db, { iid: 7, webUrl: MR_URL })).toBeNull();
  });

  it("ignores an artifact that is no longer in review", () => {
    artifactInReview("art1", 7);
    db.prepare(`UPDATE artifacts SET status = 'published' WHERE id = 'art1'`).run();
    expect(findProposalOrigin(db, { iid: 7, webUrl: MR_URL })).toBeNull();
  });
});

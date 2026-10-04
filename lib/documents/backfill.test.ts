import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertArtifact, markPublished, updateArtifact } from "@/lib/db/artifacts";
import { createDoc, recordPromotion } from "@/lib/db/chat-docs";
import {
  addComment,
  insertLink,
  insertSharedDoc,
  upsertShare as upsertLegacyShare,
} from "@/lib/db/shared-docs";
import { recordThread } from "@/lib/db/threads";
import { backfillDocuments } from "./backfill";
import { getDocument, getPublication, listComments, listDocuments, listLinks, listShares } from "./store";

let db: DatabaseType;
const OWNER = "alice@example.com";
const NOW = "2026-07-12T10:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
});

function seedPromotedDocument(): void {
  recordThread(db, "thread-1", OWNER, "Source chat", NOW);
  createDoc(db, { id: "chat-1", threadId: "thread-1", ownerEmail: OWNER, title: "Unified", body: "chat body" }, NOW);

  insertArtifact(db, { id: "artifact-copy", title: "Artifact copy", ownerEmail: OWNER, body: "artifact body" }, NOW);
  updateArtifact(
    db,
    "artifact-copy",
    OWNER,
    { status: "ready", targetPath: "docs/unified.md", targetVisibility: ["ops", "risk"] },
    NOW,
  );
  markPublished(db, "artifact-copy", OWNER, "docs/unified.md", "published", null, NOW);
  recordPromotion(db, {
    docId: "chat-1",
    ownerEmail: OWNER,
    targetType: "artifact",
    targetId: "artifact-copy",
    promotedVersion: 1,
    targetVersionAtPromote: 1,
  }, NOW);

  insertSharedDoc(db, { id: "shared-copy", title: "Shared copy", ownerEmail: OWNER, body: "shared body" }, NOW);
  upsertLegacyShare(db, "shared-copy", "bob@example.com", "comment", NOW);
  addComment(db, { id: "comment-1", docId: "shared-copy", authorEmail: "bob@example.com", body: "Looks good", anchor: null }, NOW);
  insertLink(db, { token: "token-1", docId: "shared-copy", access: "view", expiresAt: null }, NOW);
  recordPromotion(db, {
    docId: "chat-1",
    ownerEmail: OWNER,
    targetType: "shared_doc",
    targetId: "shared-copy",
    promotedVersion: 1,
    targetVersionAtPromote: 1,
  }, NOW);
}

function snapshot(): string {
  const tables = [
    "documents",
    "document_versions",
    "document_shares",
    "document_comments",
    "document_links",
    "document_publications",
  ];
  return JSON.stringify(tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}

describe("unified documents backfill", () => {
  it("collapses promoted copies into facets, imports standalones, and is idempotent", () => {
    seedPromotedDocument();
    insertArtifact(db, { id: "artifact-only", title: "Artifact only", ownerEmail: OWNER, body: "artifact standalone" }, NOW);
    insertSharedDoc(db, { id: "shared-only", title: "Shared only", ownerEmail: OWNER, body: "shared standalone" }, NOW);
    upsertLegacyShare(db, "shared-only", "dana@example.com", "edit", NOW);

    backfillDocuments(db);

    expect(listDocuments(db)).toHaveLength(3);
    expect(listDocuments(db).map((doc) => doc.id).sort()).toEqual(["artifact-only", "chat-1", "shared-only"]);
    expect(getDocument(db, "chat-1")?.originThreadId).toBe("thread-1");
    expect(getPublication(db, "chat-1")).toMatchObject({
      status: "published",
      targetPath: "docs/unified.md",
      targetVisibility: ["ops", "risk"],
      publishedNotePath: "docs/unified.md",
    });
    expect(listShares(db, "chat-1")).toEqual([
      { recipientEmail: "bob@example.com", access: "comment", createdAt: NOW },
    ]);
    expect(listComments(db, "chat-1")[0]).toMatchObject({ id: "comment-1", body: "Looks good" });
    expect(listLinks(db, "chat-1")[0]).toMatchObject({ token: "token-1", access: "view" });
    expect(getPublication(db, "artifact-only")?.status).toBe("draft");
    expect(listShares(db, "shared-only")[0]).toMatchObject({ recipientEmail: "dana@example.com", access: "edit" });

    const first = snapshot();
    backfillDocuments(db);
    expect(snapshot()).toBe(first);
    expect(listDocuments(db)).toHaveLength(3);
  });
});

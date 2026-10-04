import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { createDoc, addVersion as addDocVersion, getPromotions, recordPromotion } from "@/lib/db/chat-docs";
import { recordThread } from "@/lib/db/threads";
import { getArtifactForOwner, getVersions as artifactVersions, addVersion as artifactAddVersion } from "@/lib/db/artifacts";
import { insertSharedDoc, getSharedDoc, getVersions as sharedVersions, addVersion as sharedAddVersion } from "@/lib/db/shared-docs";
import { promote, updateTarget, promotionStatuses } from "./promote";

let db: DatabaseType;
const OWNER = "alice@example.com";
const OTHER = "bob@example.com";
const THREAD = "thread-1";

beforeEach(() => {
  db = openDb(":memory:");
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.SHARED_DOCS_ENABLED = "1";
  recordThread(db, THREAD, OWNER, "chat");
  createDoc(db, { id: "d1", threadId: THREAD, ownerEmail: OWNER, title: "Memo", body: "v1 body" });
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("promote", () => {
  it("seeds an artifact from the current version and records the promotion", () => {
    const r = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact", sourceThreadId: THREAD });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const art = getArtifactForOwner(db, r.targetId, OWNER);
    expect(art!.title).toBe("Memo");
    expect(artifactVersions(db, r.targetId, OWNER)[0].body).toBe("v1 body");
    const proms = getPromotions(db, "d1", OWNER);
    expect(proms).toHaveLength(1);
    expect(proms[0].targetType).toBe("artifact");
    expect(proms[0].promotedVersion).toBe(1);
    expect(proms[0].targetVersionAtPromote).toBe(1);
  });

  it("can promote to an artifact AND a shared doc independently (both coexist)", () => {
    const a = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    const s = promote(db, { docId: "d1", ownerEmail: OWNER, target: "shared_doc" });
    expect(a.ok && s.ok).toBe(true);
    if (!s.ok) return;
    expect(getSharedDoc(db, s.targetId)!.title).toBe("Memo");
    expect(getPromotions(db, "d1", OWNER).map((p) => p.targetType).sort()).toEqual(["artifact", "shared_doc"]);
  });

  it("refuses a target whose flag is off", () => {
    delete process.env.ARTIFACTS_ENABLED;
    const r = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    expect(r).toEqual({ ok: false, reason: "disabled" });
  });

  it("returns not_found for a foreign or unknown chat doc (no oracle)", () => {
    expect(promote(db, { docId: "d1", ownerEmail: "bob@example.com", target: "artifact" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(promote(db, { docId: "nope", ownerEmail: OWNER, target: "artifact" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("updateTarget (snapshot + additive update)", () => {
  it("does not touch the target until an explicit Update", () => {
    const r = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    if (!r.ok) throw new Error("promote failed");
    addDocVersion(db, "d1", OWNER, "v2 body");
    // The artifact is still at v1 with the snapshot content.
    expect(artifactVersions(db, r.targetId, OWNER).map((v) => v.body)).toEqual(["v1 body"]);
  });

  it("pushes a new target version cleanly when only the chat doc is ahead", () => {
    const r = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    if (!r.ok) throw new Error("promote failed");
    addDocVersion(db, "d1", OWNER, "v2 body");
    const u = updateTarget(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.classification.status).toBe("chat_ahead");
    expect(artifactVersions(db, r.targetId, OWNER).map((v) => v.body)).toEqual(["v1 body", "v2 body"]);
    // The promotion row advanced so a repeat Update is a no-op.
    const again = updateTarget(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    expect(again).toMatchObject({ ok: false, reason: "up_to_date" });
  });

  it("warns (and does not write) when the target diverged, unless confirmed", () => {
    const r = promote(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    if (!r.ok) throw new Error("promote failed");
    // The owner edited the artifact independently after promotion (target moved).
    artifactAddVersion(db, r.targetId, OWNER, "owner edit v2");
    addDocVersion(db, "d1", OWNER, "chat v2");

    const warned = updateTarget(db, { docId: "d1", ownerEmail: OWNER, target: "artifact" });
    expect(warned).toMatchObject({ ok: false, reason: "diverged" });
    // Nothing was written: the artifact is still at the owner's v2.
    expect(artifactVersions(db, r.targetId, OWNER).map((v) => v.version)).toEqual([1, 2]);

    // Confirm: the update is additive; the owner's v2 stays in history as v3 is added.
    const confirmed = updateTarget(db, { docId: "d1", ownerEmail: OWNER, target: "artifact", confirm: true });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const bodies = artifactVersions(db, r.targetId, OWNER).map((v) => v.body);
    expect(bodies).toEqual(["v1 body", "owner edit v2", "chat v2"]);
  });

  it("updates a shared-doc target additively", () => {
    const r = promote(db, { docId: "d1", ownerEmail: OWNER, target: "shared_doc" });
    if (!r.ok) throw new Error("promote failed");
    sharedAddVersion(db, r.targetId, "carol@example.com", "recipient edit");
    addDocVersion(db, "d1", OWNER, "chat v2");
    const u = updateTarget(db, { docId: "d1", ownerEmail: OWNER, target: "shared_doc", confirm: true });
    expect(u.ok).toBe(true);
    expect(sharedVersions(db, r.targetId).map((v) => v.body)).toEqual(["v1 body", "recipient edit", "chat v2"]);
  });

  it("enforces the spec-28 ACL: a promotion pointing at an inaccessible shared doc is treated as missing", () => {
    // A shared doc owned by SOMEONE ELSE (OWNER has no access), with a promotion
    // row (recorded by the thread owner) pointing at it: simulates a corrupted /
    // foreign target. It must expose nothing and refuse the additive write.
    insertSharedDoc(db, { id: "foreign-sd", title: "Secret", ownerEmail: OTHER, body: "secret v1" });
    sharedAddVersion(db, "foreign-sd", OTHER, "secret v2");
    recordPromotion(db, {
      docId: "d1",
      ownerEmail: OWNER,
      targetType: "shared_doc",
      targetId: "foreign-sd",
      promotedVersion: 1,
      targetVersionAtPromote: 1,
    });
    addDocVersion(db, "d1", OWNER, "chat v2");

    // Status does not surface the foreign target (no version-count leak).
    expect(promotionStatuses(db, "d1", OWNER)).toEqual([]);
    // Update is refused as not_found, and no version is appended to the foreign doc.
    const u = updateTarget(db, { docId: "d1", ownerEmail: OWNER, target: "shared_doc", confirm: true });
    expect(u).toMatchObject({ ok: false, reason: "not_found" });
    expect(sharedVersions(db, "foreign-sd").map((v) => v.body)).toEqual(["secret v1", "secret v2"]);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  insertArtifact,
  getArtifactForOwner,
  listArtifactsForOwner,
  addVersion,
  getVersions,
  latestBody,
  updateArtifact,
  markPublished,
  deleteArtifact,
} from "./artifacts";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

function seed(id = "a1", owner = ALICE) {
  insertArtifact(
    db,
    { id, title: "Risk disclosure draft", ownerEmail: owner, sourceThreadId: "t1", body: "# v1 body" },
    "2026-07-11T00:00:00.000Z",
  );
}

describe("artifacts store", () => {
  it("insert creates a draft with version 1 seeded from the body", () => {
    seed();
    const a = getArtifactForOwner(db, "a1", ALICE);
    expect(a).not.toBeNull();
    expect(a?.status).toBe("draft");
    expect(a?.title).toBe("Risk disclosure draft");
    expect(a?.sourceThreadId).toBe("t1");
    expect(latestBody(db, "a1", ALICE)).toBe("# v1 body");
    const versions = getVersions(db, "a1", ALICE);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].body).toBe("# v1 body");
  });

  it("is owner-private: a foreign owner and an unknown id both read as null (no oracle)", () => {
    seed();
    expect(getArtifactForOwner(db, "a1", BOB)).toBeNull();
    expect(getArtifactForOwner(db, "does-not-exist", ALICE)).toBeNull();
  });

  it("body/version reads are owner-scoped: a foreign owner sees the SAME empty as an unknown id", () => {
    seed();
    // Foreign owner: the artifact exists but is not Bob's.
    expect(latestBody(db, "a1", BOB)).toBeNull();
    expect(getVersions(db, "a1", BOB)).toEqual([]);
    // Unknown id for the real owner: identical empty, no existence oracle.
    expect(latestBody(db, "nope", ALICE)).toBeNull();
    expect(getVersions(db, "nope", ALICE)).toEqual([]);
    // And they match each other byte-for-byte.
    expect(latestBody(db, "a1", BOB)).toBe(latestBody(db, "nope", ALICE));
    expect(getVersions(db, "a1", BOB)).toEqual(getVersions(db, "nope", ALICE));
  });

  it("listArtifactsForOwner returns only the caller's artifacts, newest first", () => {
    insertArtifact(db, { id: "a1", title: "One", ownerEmail: ALICE, body: "b1" }, "2026-07-11T00:00:00.000Z");
    insertArtifact(db, { id: "a2", title: "Two", ownerEmail: ALICE, body: "b2" }, "2026-07-11T00:00:02.000Z");
    insertArtifact(db, { id: "b1", title: "Bob", ownerEmail: BOB, body: "b3" }, "2026-07-11T00:00:01.000Z");
    const list = listArtifactsForOwner(db, ALICE);
    expect(list.map((a) => a.id)).toEqual(["a2", "a1"]);
  });

  it("addVersion appends a new version and advances latestBody; history is retrievable", () => {
    seed();
    expect(addVersion(db, "a1", ALICE, "# v2 body", { now: "2026-07-11T01:00:00.000Z" })).toBe(true);
    expect(addVersion(db, "a1", ALICE, "# v3 body", { now: "2026-07-11T02:00:00.000Z" })).toBe(true);
    expect(latestBody(db, "a1", ALICE)).toBe("# v3 body");
    const versions = getVersions(db, "a1", ALICE);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("addVersion for a non-owner does not write and returns false", () => {
    seed();
    expect(addVersion(db, "a1", BOB, "# malicious", { now: "2026-07-11T01:00:00.000Z" })).toBe(false);
    expect(latestBody(db, "a1", ALICE)).toBe("# v1 body");
    expect(getVersions(db, "a1", ALICE)).toHaveLength(1);
  });

  it("updateArtifact sets target fields and status, scoped to the owner", () => {
    seed();
    expect(
      updateArtifact(db, "a1", ALICE, {
        targetPath: "docs/notes/risk.md",
        targetVisibility: ["all-hands"],
        status: "ready",
      }),
    ).toBe(true);
    const a = getArtifactForOwner(db, "a1", ALICE);
    expect(a?.status).toBe("ready");
    expect(a?.targetPath).toBe("docs/notes/risk.md");
    expect(a?.targetVisibility).toEqual(["all-hands"]);
  });

  it("updateArtifact for a non-owner changes nothing and returns false", () => {
    seed();
    expect(updateArtifact(db, "a1", BOB, { status: "ready" })).toBe(false);
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("draft");
  });

  it("markPublished records the published note path and flips status", () => {
    seed();
    expect(markPublished(db, "a1", ALICE, "docs/notes/risk.md")).toBe(true);
    const a = getArtifactForOwner(db, "a1", ALICE);
    expect(a?.status).toBe("published");
    expect(a?.publishedNotePath).toBe("docs/notes/risk.md");
  });

  it("deleteArtifact removes the artifact and its versions for the owner", () => {
    seed();
    addVersion(db, "a1", ALICE, "# v2", { now: "2026-07-11T01:00:00.000Z" });
    expect(deleteArtifact(db, "a1", BOB)).toBe(false);
    expect(deleteArtifact(db, "a1", ALICE)).toBe(true);
    expect(getArtifactForOwner(db, "a1", ALICE)).toBeNull();
    expect(getVersions(db, "a1", ALICE)).toHaveLength(0);
  });
});

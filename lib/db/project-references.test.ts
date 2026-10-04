import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./client";
import { createProject } from "./projects";
import { insertArtifact } from "./artifacts";
import { insertSharedDoc, upsertShare, removeShare } from "./shared-docs";
import {
  attachableFor,
  deleteProjectReference,
  insertProjectReference,
  listProjectReferences,
  resolveProjectReferences,
} from "./project-references";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

let db: import("better-sqlite3").Database;

function reference(overrides: Partial<Parameters<typeof insertProjectReference>[1]> = {}) {
  return {
    id: "r1",
    projectId: "p1",
    kind: "shared_doc" as const,
    targetId: "doc1",
    addedBy: ALICE,
    createdAt: "2026-07-23T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.SHARED_DOCS_ENABLED = "1";
  createProject(db, {
    id: "p1",
    name: "Launch",
    description: null,
    context: null,
    clearance: ["all-hands"],
    ownerEmail: ALICE,
    createdAt: "2026-07-01T00:00:00Z",
  });
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("project references", () => {
  it("stores a reference rather than a copy of the target", () => {
    insertSharedDoc(db, { id: "doc1", title: "Launch checklist", ownerEmail: BOB, body: "one\ntwo" });
    upsertShare(db, "doc1", ALICE, "view");
    insertProjectReference(db, reference());

    const rows = listProjectReferences(db, "p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "shared_doc", targetId: "doc1", addedBy: ALICE });
    // The row carries no title and no body: it points, it does not duplicate.
    expect(Object.keys(rows[0])).not.toContain("title");
  });

  it("resolves the target's live title and a link to it", () => {
    insertSharedDoc(db, { id: "doc1", title: "Launch checklist", ownerEmail: BOB, body: "one" });
    upsertShare(db, "doc1", ALICE, "view");
    insertProjectReference(db, reference());

    const resolved = resolveProjectReferences(db, "p1", ALICE, ["all-hands"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].title).toBe("Launch checklist");
    expect(resolved[0].href).toBe("/docs/doc1");
  });

  it("drops a reference from the view when access to the target is revoked, keeping the row", () => {
    insertSharedDoc(db, { id: "doc1", title: "Launch checklist", ownerEmail: BOB, body: "one" });
    upsertShare(db, "doc1", ALICE, "view");
    insertProjectReference(db, reference());
    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(1);

    removeShare(db, "doc1", ALICE);

    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(0);
    expect(listProjectReferences(db, "p1")).toHaveLength(1);

    // Re-granting brings it straight back, which is the point of a reference.
    upsertShare(db, "doc1", ALICE, "view");
    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(1);
  });

  it("hides an artifact reference from anyone but its owner", () => {
    insertArtifact(db, { id: "a1", title: "Pricing memo", ownerEmail: ALICE, body: "draft" });
    insertProjectReference(db, reference({ kind: "artifact", targetId: "a1" }));

    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(1);
    expect(resolveProjectReferences(db, "p1", BOB, ["all-hands"])).toHaveLength(0);
  });

  it("omits a reference whose target was deleted outright", () => {
    insertProjectReference(db, reference({ targetId: "gone" }));
    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(0);
  });

  it("treats a repeat attachment as a no-op, not a duplicate row", () => {
    insertSharedDoc(db, { id: "doc1", title: "Checklist", ownerEmail: ALICE, body: "one" });
    expect(insertProjectReference(db, reference())).toBe(true);
    expect(insertProjectReference(db, reference({ id: "r2" }))).toBe(false);
    expect(listProjectReferences(db, "p1")).toHaveLength(1);
  });

  it("detaches only within the owning project", () => {
    insertProjectReference(db, reference());
    expect(deleteProjectReference(db, "other", "r1")).toBe(false);
    expect(deleteProjectReference(db, "p1", "r1")).toBe(true);
    expect(listProjectReferences(db, "p1")).toHaveLength(0);
  });
});

describe("attachableFor", () => {
  it("offers the requester's own artifacts and every doc they own or hold a share on", () => {
    insertArtifact(db, { id: "a1", title: "Mine", ownerEmail: ALICE, body: "x" });
    insertArtifact(db, { id: "a2", title: "Not mine", ownerEmail: BOB, body: "x" });
    insertSharedDoc(db, { id: "d1", title: "Owned", ownerEmail: ALICE, body: "x" });
    insertSharedDoc(db, { id: "d2", title: "Shared with me", ownerEmail: BOB, body: "x" });
    insertSharedDoc(db, { id: "d3", title: "Stranger's", ownerEmail: BOB, body: "x" });
    upsertShare(db, "d2", ALICE, "comment");

    const ids = attachableFor(db, ALICE).map((t) => t.targetId).sort();
    expect(ids).toEqual(["a1", "d1", "d2"]);
  });

  it("offers no shared docs when the shared-docs flag is off", () => {
    delete process.env.SHARED_DOCS_ENABLED;
    insertArtifact(db, { id: "a1", title: "Mine", ownerEmail: ALICE, body: "x" });
    insertSharedDoc(db, { id: "d1", title: "Owned", ownerEmail: ALICE, body: "x" });
    expect(attachableFor(db, ALICE).map((t) => t.targetId)).toEqual(["a1"]);
  });
});

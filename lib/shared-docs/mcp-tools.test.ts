import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { getSharedDoc, getVersions, insertSharedDoc, latestBody, latestVersionOf } from "@/lib/db/shared-docs";
import { upsertShare } from "@/lib/db/shared-doc-shares";
import { createProject } from "@/lib/db/projects";
import { listProjectReferences } from "@/lib/db/project-references";
import { sharedDocAttach, sharedDocCreate, sharedDocUpdate, type SharedDocToolContext } from "./mcp-tools";

vi.mock("@/lib/config/flags", () => ({ isFlagEnabled: () => true }));
vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => ({}),
  resolveClearance: () => ["all-hands"],
}));
vi.mock("@/lib/identity/resolve", () => ({ resolveClearanceForEmail: () => ["all-hands"] }));

let db: DatabaseType;

const OWNER = "alice@example.com";
const EDITOR = "bob@example.com";
const STRANGER = "carol@example.com";
const BODY = "# Spec\n\nThe published body.\n";
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

function ctx(ownerEmail: string = OWNER): SharedDocToolContext {
  return { db, ownerEmail };
}

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Spec", ownerEmail: OWNER, body: BODY });
  upsertShare(db, "d1", EDITOR, "edit");
  createProject(db, {
    id: "p1",
    name: "Meridian Product",
    description: null,
    context: null,
    clearance: ["all-hands"],
    ownerEmail: OWNER,
    createdAt: new Date().toISOString(),
  });
});

describe("sharedDocCreate", () => {
  it("creates a document owned by the caller at version 1", () => {
    const outcome = sharedDocCreate(ctx(), { title: "Phase 1", body: "Body." });
    expect(outcome).toMatchObject({ ok: true, result: { version: 1 } });
    if (!outcome.ok) return;
    expect(getSharedDoc(db, outcome.result.docId)?.ownerEmail).toBe(OWNER);
    expect(latestBody(db, outcome.result.docId)).toBe("Body.");
  });

  it("refuses an empty title, an over-long title, and an empty body", () => {
    expect(sharedDocCreate(ctx(), { title: "   ", body: "Body." }).ok).toBe(false);
    expect(sharedDocCreate(ctx(), { title: "x".repeat(121), body: "Body." }).ok).toBe(false);
    expect(sharedDocCreate(ctx(), { title: "Phase 1", body: "" }).ok).toBe(false);
  });
});

describe("sharedDocUpdate", () => {
  it("appends a version for the owner", () => {
    const outcome = sharedDocUpdate(ctx(), { docId: "d1", body: "Revised." });
    expect(outcome).toMatchObject({ ok: true, result: { version: 2 } });
    expect(latestBody(db, "d1")).toBe("Revised.");
  });

  it("with neither title nor body, reports the current version and writes nothing", () => {
    const before = getVersions(db, "d1").length;
    const outcome = sharedDocUpdate(ctx(), { docId: "d1" });
    expect(outcome).toMatchObject({ ok: true, result: { version: 1 } });
    expect(getVersions(db, "d1")).toHaveLength(before);
  });

  it("reports the caller's tier, so a preflight can tell ownership from mere read access", () => {
    expect(sharedDocUpdate(ctx(), { docId: "d1" })).toMatchObject({
      ok: true,
      result: { yourAccess: "owner" },
    });
    expect(sharedDocUpdate(ctx(EDITOR), { docId: "d1" })).toMatchObject({
      ok: true,
      result: { yourAccess: "edit" },
    });
  });

  it("refuses the preflight for a caller who does not own the document, so a run cannot fall through to create", () => {
    expect(sharedDocUpdate(ctx(STRANGER), { docId: "d1" }).ok).toBe(false);
  });

  it("answers identically for an unreachable document and an unknown id", () => {
    const unreachable = sharedDocUpdate(ctx(STRANGER), { docId: "d1", body: "x" });
    const unknown = sharedDocUpdate(ctx(STRANGER), { docId: UNKNOWN_ID, body: "x" });
    expect(unreachable).toEqual(unknown);
  });

  it("lets an edit-shared caller change the body but not the title", () => {
    expect(sharedDocUpdate(ctx(EDITOR), { docId: "d1", body: "Revised." }).ok).toBe(true);
    const renamed = sharedDocUpdate(ctx(EDITOR), { docId: "d1", title: "New name" });
    expect(renamed.ok).toBe(false);
    expect(getSharedDoc(db, "d1")?.title).toBe("Spec");
  });

  it("carries the stored format forward, so a designed document is not relabelled as markdown", () => {
    insertSharedDoc(db, { id: "d2", title: "Designed", ownerEmail: OWNER, body: "<h1>x</h1>", format: "html" });
    sharedDocUpdate(ctx(), { docId: "d2", body: "<h1>y</h1>" });
    expect(latestVersionOf(db, "d2")?.format).toBe("html");
  });
});

describe("sharedDocAttach", () => {
  it("attaches a document the caller can reach to a project they can see", () => {
    const outcome = sharedDocAttach(ctx(), { projectId: "p1", docId: "d1" });
    expect(outcome).toMatchObject({ ok: true, result: { attached: true } });
    expect(listProjectReferences(db, "p1")).toHaveLength(1);
  });

  it("reports a re-attach as not newly attached, without a duplicate row", () => {
    sharedDocAttach(ctx(), { projectId: "p1", docId: "d1" });
    const again = sharedDocAttach(ctx(), { projectId: "p1", docId: "d1" });
    expect(again).toMatchObject({ ok: true, result: { attached: false } });
    expect(listProjectReferences(db, "p1")).toHaveLength(1);
  });

  it("refuses a document the caller cannot reach", () => {
    insertSharedDoc(db, { id: "d3", title: "Private", ownerEmail: STRANGER, body: "x" });
    expect(sharedDocAttach(ctx(), { projectId: "p1", docId: "d3" }).ok).toBe(false);
    expect(listProjectReferences(db, "p1")).toHaveLength(0);
  });

  it("answers identically for an unknown project and one the caller cannot see", () => {
    createProject(db, {
      id: "p2",
      name: "Foreign",
      description: null,
      context: null,
      clearance: ["finance"],
      ownerEmail: STRANGER,
      createdAt: new Date().toISOString(),
    });
    const foreign = sharedDocAttach(ctx(), { projectId: "p2", docId: "d1" });
    const unknown = sharedDocAttach(ctx(), { projectId: UNKNOWN_ID, docId: "d1" });
    expect(foreign).toEqual(unknown);
  });
});

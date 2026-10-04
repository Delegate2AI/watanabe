import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { createProject } from "./projects";
import {
  insertProjectDocument,
  listProjectDocuments,
  getProjectDocument,
  deleteProjectDocument,
  type ProjectDocument,
} from "./project-docs";

let db: DatabaseType;

function seedProject(id: string) {
  createProject(db, {
    id,
    name: `Project ${id}`,
    description: null,
    context: null,
    clearance: ["all-hands"],
    ownerEmail: "alice@example.com",
    createdAt: "2026-07-12T00:00:00Z",
  });
}

function doc(id: string, projectId: string, overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id,
    projectId,
    filename: `${id}.pdf`,
    contentType: "application/pdf",
    byteSize: 1024,
    uploaderEmail: "alice@example.com",
    createdAt: "2026-07-12T01:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  seedProject("p1");
  seedProject("p2");
});

describe("project-docs", () => {
  it("inserts and lists documents scoped to a project, newest first", () => {
    insertProjectDocument(db, doc("d1", "p1", { createdAt: "2026-07-12T01:00:00Z" }));
    insertProjectDocument(db, doc("d2", "p1", { createdAt: "2026-07-12T02:00:00Z" }));
    insertProjectDocument(db, doc("d3", "p2"));

    const list = listProjectDocuments(db, "p1");
    expect(list.map((d) => d.id)).toEqual(["d2", "d1"]);
    expect(listProjectDocuments(db, "p2").map((d) => d.id)).toEqual(["d3"]);
  });

  it("never returns a document from another project", () => {
    insertProjectDocument(db, doc("d1", "p1"));
    expect(getProjectDocument(db, "p1", "d1")).not.toBeNull();
    // Same id, wrong project -> null (no cross-project read).
    expect(getProjectDocument(db, "p2", "d1")).toBeNull();
  });

  it("deletes scoped to the project and reports whether anything matched", () => {
    insertProjectDocument(db, doc("d1", "p1"));
    expect(deleteProjectDocument(db, "p2", "d1")).toBe(false);
    expect(deleteProjectDocument(db, "p1", "d1")).toBe(true);
    expect(listProjectDocuments(db, "p1")).toEqual([]);
  });
});

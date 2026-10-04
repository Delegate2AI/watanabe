import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { attachThread, createProject } from "./projects";
import { recordThread } from "./threads";
import { projectContextForThread } from "./project-context";

const OWNER = "alice@example.com";
const THREAD = "11111111-1111-4111-8111-111111111111";

let db: DatabaseType;

function project(id: string, over: { context?: string | null; clearance?: string[]; ownerEmail?: string } = {}): void {
  createProject(db, {
    id,
    name: `Project ${id}`,
    description: null,
    context: over.context === undefined ? "Write for the board." : over.context,
    clearance: over.clearance ?? ["all-hands"],
    ownerEmail: over.ownerEmail ?? OWNER,
    createdAt: "2026-10-01T00:00:00Z",
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  recordThread(db, THREAD, OWNER, "A thread");
});

describe("projectContextForThread", () => {
  it("returns the context of the project the owner filed the thread into", () => {
    project("p1", { context: "  Write for the board.\n" });
    expect(attachThread(db, "p1", THREAD, OWNER, ["all-hands"])).toBe(true);

    expect(projectContextForThread(db, THREAD, OWNER, ["all-hands"])).toBe("Write for the board.");
  });

  it("returns undefined for a thread in no project", () => {
    expect(projectContextForThread(db, THREAD, OWNER, ["all-hands"])).toBeUndefined();
  });

  it("returns undefined when the project has no context", () => {
    project("p1", { context: "   " });
    attachThread(db, "p1", THREAD, OWNER, ["all-hands"]);

    expect(projectContextForThread(db, THREAD, OWNER, ["all-hands"])).toBeUndefined();
  });

  it("fails closed when the owner can no longer see the project", () => {
    project("p1", { clearance: ["exec"], ownerEmail: "boss@example.com" });
    attachThread(db, "p1", THREAD, OWNER, ["exec"]);

    expect(projectContextForThread(db, THREAD, OWNER, ["all-hands"])).toBeUndefined();
  });

  it("fails closed for a requester who does not own the thread", () => {
    project("p1");
    attachThread(db, "p1", THREAD, OWNER, ["all-hands"]);

    expect(projectContextForThread(db, THREAD, "mallory@example.com", ["all-hands"])).toBeUndefined();
  });
});

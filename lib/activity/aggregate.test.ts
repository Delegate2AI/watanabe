import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertProposed } from "@/lib/db/tasks";
import { insertSharedDoc, upsertShare } from "@/lib/db/shared-docs";
import { requestAccess, decideRequest } from "@/lib/db/doc-access-requests";

const projection = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => projection.root }));

const { newSince } = await import("./aggregate");

let db: DatabaseType;
const cursor = "2026-07-11T12:00:00.000Z";
const createdAt = "2026-07-11T13:00:00.000Z";

function addTask(id: string, assigneeEmail: string | null, clearance: string[]) {
  insertProposed(db, {
    id,
    title: id,
    description: "Description",
    assigneeEmail,
    sourceMeetingId: `meeting:${id}`,
    sourceNotePath: `docs/meetings/${id}.md`,
    clearance,
    due: null,
    origin: "circleback",
    createdAt,
  });
}

function addMeeting(id: string, notePath: string) {
  db.prepare(`
    INSERT INTO ingested_meetings (meeting_id, note_path, source_hash, ingested_at)
    VALUES (@id, @notePath, @hash, @createdAt)
  `).run({ id, notePath, hash: id, createdAt });
}

beforeEach(() => {
  db = openDb(":memory:");
  projection.root = path.join(tmpdir(), `activity-projection-${crypto.randomUUID()}`);
  mkdirSync(path.join(projection.root, "meetings"), { recursive: true });
  process.env.ACTIVITY_ENABLED = "1";
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ACCESS_REQUESTS_ENABLED = "1";
});

afterEach(() => {
  db.close();
  rmSync(projection.root, { recursive: true, force: true });
  delete process.env.ACTIVITY_ENABLED;
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
});

describe("newSince", () => {
  it("groups only task records allowed by the existing task visibility scope", () => {
    addTask("mine", "alice@example.com", ["exec"]);
    addTask("triage", null, ["exec"]);
    addTask("foreign", "bob@example.com", ["exec"]);
    addTask("restricted", "alice@example.com", ["board"]);

    const feed = newSince(db, "alice@example.com", ["all-hands", "exec"], cursor);
    expect(feed.tasks.map((item) => item.id).sort()).toEqual(["mine", "triage"]);
    expect(feed.unreadCount).toBe(2);
  });

  it("includes a meeting only when its note is present in the requester projection", () => {
    addMeeting("visible", "docs/meetings/visible.md");
    addMeeting("hidden", "docs/meetings/hidden.md");
    writeFileSync(path.join(projection.root, "meetings", "visible.md"), "---\nvisibility: [exec]\n---\n# Visible\n");

    const feed = newSince(db, "alice@example.com", ["all-hands", "exec"], cursor);
    expect(feed.meetings.map((item) => item.id)).toEqual(["visible"]);
    expect(feed.meetings[0].href).toBe("/kb/meetings/visible");
  });

  it("includes a shared doc only for its current exact recipient", () => {
    insertSharedDoc(db, { id: "shared", title: "Shared", ownerEmail: "owner@example.com", body: "Body" }, createdAt);
    insertSharedDoc(db, { id: "foreign", title: "Foreign", ownerEmail: "owner@example.com", body: "Body" }, createdAt);
    upsertShare(db, "shared", "alice@example.com", "view", createdAt);
    upsertShare(db, "foreign", "bob@example.com", "view", createdAt);

    const feed = newSince(db, " ALICE@example.com ", ["all-hands"], cursor);
    expect(feed.sharedDocs.map((item) => item.id)).toEqual(["shared"]);
    expect(feed.sharedDocs[0].href).toBe("/docs/shared");
  });

  it("puts an access request in front of the document's owner and nobody else", () => {
    insertSharedDoc(db, { id: "mine", title: "My plan", ownerEmail: "alice@example.com", body: "Body" }, createdAt);
    insertSharedDoc(db, { id: "theirs", title: "Their plan", ownerEmail: "bob@example.com", body: "Body" }, createdAt);
    requestAccess(db, { docId: "mine", requesterEmail: "dana@example.com", access: "edit", message: "please" }, createdAt);
    requestAccess(db, { docId: "theirs", requesterEmail: "dana@example.com", access: "edit", message: null }, createdAt);

    const feed = newSince(db, "alice@example.com", ["all-hands"], cursor);
    expect(feed.accessRequests.map((item) => item.title)).toEqual(["My plan"]);
    expect(feed.accessRequests[0].href).toBe("/docs/mine");
    // The message is for the owner's panel on the document, not for the bell.
    expect(feed.accessRequests[0].title).not.toContain("please");
    expect(feed.unreadCount).toBe(1);
  });

  it("drops an access request the owner has already answered", () => {
    insertSharedDoc(db, { id: "mine", title: "My plan", ownerEmail: "alice@example.com", body: "Body" }, createdAt);
    const asked = requestAccess(db, { docId: "mine", requesterEmail: "dana@example.com", access: "view", message: null }, createdAt);
    decideRequest(db, "mine", asked.id, "declined", "alice@example.com");

    expect(newSince(db, "alice@example.com", ["all-hands"], cursor).accessRequests).toEqual([]);
  });

  it("contributes nothing when the activity surface is disabled", () => {
    addTask("mine", "alice@example.com", ["exec"]);
    delete process.env.ACTIVITY_ENABLED;
    expect(newSince(db, "alice@example.com", ["exec"], cursor)).toEqual({
      tasks: [], meetings: [], sharedDocs: [], accessRequests: [], taskComments: [], unreadCount: 0,
    });
  });

  it.each([
    ["TASKS_ENABLED", "tasks"],
    ["MEETINGS_ENABLED", "meetings"],
    ["SHARED_DOCS_ENABLED", "sharedDocs"],
    ["DOC_ACCESS_REQUESTS_ENABLED", "accessRequests"],
  ] as const)("gates %s independently", (flag, group) => {
    addTask("mine", "alice@example.com", ["exec"]);
    addMeeting("visible", "docs/meetings/visible.md");
    writeFileSync(path.join(projection.root, "meetings", "visible.md"), "# Visible\n");
    insertSharedDoc(db, { id: "shared", title: "Shared", ownerEmail: "owner@example.com", body: "Body" }, createdAt);
    upsertShare(db, "shared", "alice@example.com", "view", createdAt);
    insertSharedDoc(db, { id: "mine", title: "Mine", ownerEmail: "alice@example.com", body: "Body" }, createdAt);
    requestAccess(db, { docId: "mine", requesterEmail: "bob@example.com", access: "view", message: null }, createdAt);
    delete process.env[flag];

    expect(newSince(db, "alice@example.com", ["exec"], cursor)[group]).toEqual([]);
  });
});

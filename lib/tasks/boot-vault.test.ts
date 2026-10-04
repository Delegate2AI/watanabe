import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { getTaskForRequester, insertProposed } from "@/lib/db/tasks";
import { bootTasks } from "./boot";

const roots = { unfiltered: "", projection: "" };

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return {
    ...actual,
    vaultRoot: () => roots.projection,
    unfilteredVaultRoot: () => roots.unfiltered,
  };
});

const ORIGINAL = { ...process.env };

const NOTE_BODY = [
  "---",
  "type: meeting",
  "visibility:",
  "  - admins",
  "attendees:",
  "  - dana@example.com",
  "---",
  "",
  "Notes.",
].join("\n");

beforeEach(() => {
  process.env = { ...ORIGINAL };
  process.env.TASKS_ENABLED = "1";
  roots.unfiltered = mkdtempSync(path.join(tmpdir(), "vault-unfiltered-"));
  roots.projection = mkdtempSync(path.join(tmpdir(), "vault-projection-"));
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe("the default note reader", () => {
  it("reads from the unfiltered checkout, not the all-hands projection", () => {
    const noteDir = path.join(roots.unfiltered, "meetings", "2026");
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(path.join(noteDir, "stream.md"), NOTE_BODY);

    const db = openDb(":memory:");
    insertProposed(db, {
      id: "t1",
      title: "Fix the background video",
      description: "Shorten it to clear the five minute limit.",
      assigneeEmail: null,
      sourceMeetingId: "circleback:m1",
      sourceNotePath: "docs/meetings/2026/stream.md",
      clearance: ["admins"],
      due: null,
      origin: "circleback",
      createdAt: "2026-08-05T12:00:00Z",
    });

    bootTasks({ db, aliases: {} });

    expect(getTaskForRequester(db, "t1", "dana@example.com", ["all-hands"])?.sourceAttendees).toEqual([
      "dana@example.com",
    ]);
  });
});

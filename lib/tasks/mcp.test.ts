import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertProposed, setStatus } from "@/lib/db/tasks";
import { createTasksMcpServer, listTasksForMcp } from "./mcp";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  const common = {
    description: "Description",
    sourceMeetingId: "circleback:m1",
    sourceNotePath: "docs/meetings/m1.md",
    clearance: ["exec"],
    due: null,
    origin: "circleback" as const,
    createdAt: "2026-07-11T12:00:00Z",
  };
  insertProposed(db, { ...common, id: "mine", title: "Mine", assigneeEmail: "alice@example.com" });
  insertProposed(db, { ...common, id: "foreign", title: "Foreign", assigneeEmail: "bob@example.com" });
  insertProposed(db, { ...common, id: "triage", title: "Triage", assigneeEmail: null });
  insertProposed(db, { ...common, id: "done", title: "Done", assigneeEmail: "alice@example.com" });
  setStatus(db, "done", "done");
});

describe("tasks MCP", () => {
  it("lists only the session owner's active tasks and cleared triage", () => {
    expect(listTasksForMcp(db, "alice@example.com", ["all-hands", "exec"]).map((task) => task.id).sort())
      .toEqual(["mine", "triage"]);
  });

  it("registers exactly one read-only list tool", () => {
    const server = createTasksMcpServer("alice@example.com", { db, clearance: ["exec"] });
    const instance = server.instance as unknown as { _registeredTools: Record<string, unknown> };
    expect(Object.keys(instance._registeredTools)).toEqual(["list"]);
  });
});

import type { Database as DatabaseType } from "better-sqlite3";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { getForRequester, type TaskRecord } from "@/lib/db/tasks";

export function listTasksForMcp(
  db: DatabaseType,
  ownerEmail: string,
  clearance: string[],
): TaskRecord[] {
  return getForRequester(db, ownerEmail, clearance, ["proposed", "open"]);
}

export function createTasksMcpServer(
  ownerEmail: string,
  options?: { db?: DatabaseType; clearance?: string[] },
) {
  const db = options?.db ?? getDb();
  const clearance = options?.clearance ?? resolveClearance(ownerEmail, loadGroups());
  return createSdkMcpServer({
    name: "tasks",
    version: "1.0.0",
    instructions: "Read the current session owner's proposed and open meeting-derived tasks.",
    alwaysLoad: true,
    tools: [
      tool(
        "list",
        "List the current user's proposed and open tasks, including cleared unassigned tasks needing triage.",
        {},
        async () => ({
          content: [{ type: "text" as const, text: JSON.stringify(listTasksForMcp(db, ownerEmail, clearance)) }],
        }),
      ),
    ],
  });
}

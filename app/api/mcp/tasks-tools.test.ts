import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The eight task tools, driven directly off the registered server rather than
 * through the transport, exactly as `server-write.test.ts` drives the staging
 * tools.
 *
 * Everything below the tool layer is real: a `:memory:` database, the real
 * services, the real actor. Only `can` is a seam, because the point of several
 * of these cases is that a capability is resolved per call rather than frozen
 * when the session was built.
 */

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  can: true,
  groups: {
    exec: ["alice@example.com", "bob@example.com"],
    research: ["carol@example.com"],
  } as Record<string, string[]>,
}));

// Only the roles file location is pinned, so `can` cannot pick up whatever the
// developer's worktree happens to hold, and neither can the flag overrides.
vi.mock("@/lib/memory/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/config")>();
  return { ...actual, memoryWorktreeDir: () => path.join(os.tmpdir(), "mcp-task-tools-no-roles") };
});

vi.mock("@/lib/authority/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/roles")>();
  return { ...actual, can: () => h.can };
});

// `loadGroups` only. `resolveClearance` and `isKnownMember` stay real, because
// they are the rules under test rather than scenery.
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => h.groups };
});

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => h.db };
});

// The knowledge-base half of this server is another spec's surface. Stubbed so
// this file builds no vault and asserts on nothing but the task tools.
vi.mock("@/lib/kb-mcp/tools", () => ({
  kbList: async () => ({ content: [] }),
  kbRead: async () => ({ content: [] }),
  kbSearch: async () => ({ content: [] }),
  textResult: (text: string) => ({ content: [{ type: "text", text }] }),
  errorResult: (text: string) => ({ content: [{ type: "text", text }], isError: true }),
}));
vi.mock("@/lib/kb-mcp/write-tools", () => ({ createWriteTools: () => [] }));
vi.mock("@/lib/agent/permissions", () => ({ isKbWriteEnabled: () => false }));
vi.mock("@/lib/shared-docs/config", () => ({ isSharedDocsEnabled: () => false }));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => "/vault" }));

const { openDb } = await import("@/lib/db/client");
const { createManualTask, insertProposed } = await import("@/lib/db/tasks");
const { addComment } = await import("@/lib/db/task-comments");
const { MESSAGES } = await import("@/lib/errors/messages");
const { CreateTaskShape } = await import("@/lib/tasks/service/schemas");
const { taskTools } = await import("@/lib/tasks/mcp-tools");
const { buildServer } = await import("./server");

type Registered = { handler: (args: unknown) => unknown; annotations?: Record<string, unknown> };
type Servable = { _registeredTools: Record<string, Registered> };

function toolNames(server: unknown): string[] {
  return Object.keys((server as Servable)._registeredTools).sort();
}

async function callTool(server: unknown, name: string, args: Record<string, unknown>) {
  const registered = (server as Servable)._registeredTools[name];
  expect(registered, `tool ${name} is not registered`).toBeDefined();
  return (await registered.handler(args)) as { content: { text: string }[]; isError?: boolean };
}

/** A session that may hold write tools, which is what a token or OAuth caller gets. */
function session(email = "alice@example.com") {
  return buildServer(email, { threadId: "mcp-s1" });
}

const PROPOSED = {
  description: "Description",
  sourceMeetingId: "circleback:m1",
  sourceNotePath: "docs/meetings/m1.md",
  clearance: ["exec"],
  due: null,
  origin: "circleback" as const,
  createdAt: "2026-09-04T12:00:00Z",
};

let bobsTask: string;

beforeEach(() => {
  h.db = openDb(":memory:");
  h.can = true;
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.TASK_COMMENTS_ENABLED = "1";
  insertProposed(h.db as never, { ...PROPOSED, id: "triage", title: "Triage", assigneeEmail: null });
  // Open, and created by somebody else: deleting it needs manageAccess, which
  // the MCP editor floor deliberately does not grant.
  bobsTask = createManualTask(h.db as never, {
    title: "Bob's",
    description: "",
    assignees: ["alice@example.com"],
    clearance: ["exec"],
    due: null,
    createdBy: "bob@example.com",
    createdAt: "2026-09-04T12:00:00Z",
  }).id;
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.TASK_COMMENTS_ENABLED;
});

describe("registration", () => {
  it("registers no task tool at all when the subsystem is off", () => {
    delete process.env.TASKS_ENABLED;

    expect(toolNames(session()).filter((name) => name.startsWith("tasks_"))).toEqual([]);
  });

  it("gives a plain member all eight, with no role beyond membership", () => {
    h.can = false;

    expect(toolNames(session()).filter((name) => name.startsWith("tasks_"))).toEqual([
      "tasks_comment_add",
      "tasks_comment_delete",
      "tasks_comment_list",
      "tasks_create",
      "tasks_get",
      "tasks_list",
      "tasks_transition",
      "tasks_update",
    ]);
  });

  // A cookie caller gets read parity in MR5. Until then the surface is what it
  // was, so the exact-array assertions in the two sibling test files hold.
  it("registers none of them for a cookie caller", () => {
    expect(toolNames(buildServer("alice@example.com"))).toEqual(["kb_list", "kb_read", "kb_search"]);
  });

  it("drops the comment tools alone when only their flag is off", () => {
    delete process.env.TASK_COMMENTS_ENABLED;

    const names = toolNames(session()).filter((name) => name.startsWith("tasks_"));
    expect(names).toEqual(["tasks_create", "tasks_get", "tasks_list", "tasks_transition", "tasks_update"]);
  });

  // The schema is the service's, not a second copy that drifts on the first
  // field anybody adds.
  it("registers the service's own shape rather than restating it", () => {
    const create = taskTools().find((tool) => tool.name === "tasks_create");
    expect(create?.inputSchema).toBe(CreateTaskShape);
  });
});

describe("what a tool answers", () => {
  it("cannot be used to tell a task you may not see from one that does not exist", async () => {
    const server = session();

    const unreachable = await callTool(server, "tasks_get", { id: "invented-id" });
    const foreign = await callTool(server, "tasks_get", { id: "also-invented" });

    expect(unreachable).toEqual(foreign);
    expect(unreachable.content[0].text).toBe(MESSAGES.not_found);
    expect(unreachable.isError).toBe(true);
  });

  it("refuses a create stamped with a group the caller is not in, and names the field", async () => {
    const result = await callTool(session(), "tasks_create", {
      title: "Cross-group",
      description: "",
      clearance: "research",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`${MESSAGES.invalid_request} (clearance)`);
  });

  it("defaults the page to 50 without changing what the REST list returns", async () => {
    for (let n = 0; n < 60; n += 1) {
      insertProposed(h.db as never, { ...PROPOSED, id: `t${n}`, title: `T${n}`, assigneeEmail: null });
    }

    const result = await callTool(session(), "tasks_list", {});

    expect(JSON.parse(result.content[0].text).tasks).toHaveLength(50);
  });

  it("refuses a page larger than the cap rather than silently serving one", async () => {
    const result = await callTool(session(), "tasks_list", { limit: 201 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`${MESSAGES.invalid_request} (body)`);
  });
});

describe("a capability is resolved per call, not frozen at registration", () => {
  it("refuses a delete once the role is gone, while the tool stays listed", async () => {
    const server = session();
    expect(toolNames(server)).toContain("tasks_transition");

    h.can = false;
    const result = await callTool(server, "tasks_transition", { id: bobsTask, action: "delete" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(MESSAGES.needs_role);
    expect(toolNames(server)).toContain("tasks_transition");
  });

  // The floor is `write` and stops there, so a member can still act on their own
  // work with no role at all.
  it("still lets a member comment on a task they can see with no role", async () => {
    h.can = false;

    const result = await callTool(session(), "tasks_comment_add", { taskId: bobsTask, body: "Noted" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).comment.authorEmail).toBe("alice@example.com");
  });

  it("refuses deleting somebody else's comment, which needs manageAccess", async () => {
    h.can = false;
    const comment = addComment(h.db as never, {
      id: "c1",
      taskId: bobsTask,
      authorEmail: "bob@example.com",
      body: "Bob's",
      createdAt: "2026-09-04T12:30:00Z",
    });

    const result = await callTool(session(), "tasks_comment_delete", {
      taskId: bobsTask,
      commentId: comment.id,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`${MESSAGES.needs_role} (author)`);
  });
});

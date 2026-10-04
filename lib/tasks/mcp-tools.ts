import { toolResult } from "@/lib/service/mcp";
import type { McpToolDefinition } from "@/lib/service/tool-def";
import { createTask, getTask, listTasks } from "./service/tasks";
import { transitionTask } from "./service/transitions";
import {
  CreateTaskShape,
  ListTasksShape,
  TaskIdShape,
  TransitionTaskShape,
  UpdateTaskShape,
} from "./service/schemas";

/**
 * The five task tools, over the same service functions the four task routes
 * call. Not one line of authorization lives here: a tool builds no query, reads
 * no clearance and checks no role, because everything it would have checked is
 * inside the function it delegates to and is already proven by that function's
 * own tests.
 *
 * Every `capability` below is `null`, which is a claim about the REST surface
 * rather than a relaxation of it. `POST /api/tasks` checks that the caller is
 * cleared for the group they are stamping, never that they hold `write`, so
 * gating the tool on `write` would invent a rule the browser does not have and
 * refuse people the page admits.
 *
 * `lib/tasks/mcp.ts` is a different thing entirely, the in-process server the
 * chat agent talks to. Do not merge them.
 *
 * Exported as a function, not a constant, so the descriptions are built when a
 * session asks for them rather than at module load.
 */
export function taskTools(): McpToolDefinition[] {
  return [
    {
      name: "tasks_list",
      description:
        "List the tasks you can see: the ones assigned to you, plus unassigned ones in groups you are " +
        "cleared for. Optionally filter by status. Returns the 50 most recent unless you ask for more.",
      inputSchema: ListTasksShape,
      annotations: { title: "List your tasks", readOnlyHint: true, openWorldHint: false },
      capability: null,
      // The default is applied here rather than in the service, because
      // `GET /api/tasks` returns everything and must keep doing so. A page size
      // is a property of this surface, not of the operation.
      handler: (ctx, args) => toolResult(listTasks(ctx, { ...args, limit: args.limit ?? 50 })),
    },
    {
      name: "tasks_get",
      description:
        "Read one task by id, including its assignees, status and clearance. A task you are not cleared " +
        "for reads as not found, exactly as an id that was never issued does.",
      inputSchema: TaskIdShape,
      annotations: { title: "Read a task", readOnlyHint: true, openWorldHint: false },
      capability: null,
      handler: (ctx, args) => toolResult(getTask(ctx, String(args.id ?? ""))),
    },
    {
      name: "tasks_create",
      description:
        "Create a task in one of the groups you are cleared for, optionally assigned to colleagues. The " +
        "clearance group decides who can see it afterwards, so it cannot be a group you are not in.",
      inputSchema: CreateTaskShape,
      annotations: {
        title: "Create a task",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      capability: null,
      handler: (ctx, args) => toolResult(createTask(ctx, args)),
    },
    {
      name: "tasks_update",
      description:
        "Put a task on somebody: assign a proposed task that nobody holds yet, or reassign one already " +
        "underway. An assignee has to be a member who is cleared for the task, or it would be invisible " +
        "to the person you handed it to.",
      inputSchema: UpdateTaskShape,
      annotations: {
        title: "Assign a task",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      capability: null,
      handler: (ctx, args) => {
        const { id, ...rest } = args;
        return toolResult(transitionTask(ctx, String(id ?? ""), rest));
      },
    },
    {
      name: "tasks_transition",
      description:
        "Move a task through its lifecycle: accept or dismiss a proposal, complete work assigned to you, " +
        "move it to another board column, or delete one you created. Refused rather than silently ignored " +
        "when the task is not in a state the action applies to.",
      inputSchema: TransitionTaskShape,
      annotations: {
        title: "Transition a task",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      capability: null,
      handler: (ctx, args) => {
        const { id, ...rest } = args;
        return toolResult(transitionTask(ctx, String(id ?? ""), rest));
      },
    },
  ];
}

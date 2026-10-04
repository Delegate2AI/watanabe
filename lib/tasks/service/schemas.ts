import { z } from "zod";

/**
 * The one definition of what valid task input is.
 *
 * Every shape here is exported twice: as a raw zod shape, which is what the MCP
 * SDK's `inputSchema` takes, and as the assembled object the routes parse a body
 * with. That is the point of the service layer rather than a decoration of it.
 * A tool with its own schema and a route with its own schema drift on the first
 * field anybody adds, and the drift is silent until a caller hits the half that
 * was not updated.
 *
 * The shapes are copied verbatim from the handlers they replace, so parity is a
 * copy rather than a rewrite. Do not tidy the messages: they are what the
 * existing route tests assert against.
 */

export const CreateTaskShape = {
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().default(""),
  assigneeEmail: z.string().email().optional(),
  assignees: z.array(z.string().email()).max(20).optional(),
  due: z.string().optional(),
  clearance: z.string().min(1, "clearance group is required"),
};

export const CreateTaskInput = z.object(CreateTaskShape);
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const TASK_STATUSES = ["proposed", "open", "in_progress", "done", "dismissed"] as const;

/**
 * `limit` is optional and applied only when a caller asks for one, so
 * `GET /api/tasks` keeps returning everything it always has while an MCP tool
 * can default itself to a sane page. It is applied after the query rather than
 * pushed into `getForRequester`'s SQL: narrowing that statement would change the
 * REST surface, and this refactor is not allowed to.
 *
 * There is no `cursor` yet. Paging the task list properly needs a stable sort
 * key that the current statement does not guarantee, and inventing one here
 * would be a behavior change hiding in a refactor.
 */
export const ListTasksShape = {
  status: z.array(z.enum(TASK_STATUSES)).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

export const ListTasksInput = z.object(ListTasksShape);
export type ListTasksInput = z.infer<typeof ListTasksInput>;

/**
 * A task can be assigned to several people, so every assigning action takes a
 * list. The singular fields stay accepted and mean a list of one: they are the
 * shape the surfaces posted before multi-assignment, and a stale client tab must
 * not start failing mid-session.
 */
const assigneeList = z.array(z.string().email()).max(20);

export const TransitionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    assignee: z.string().email().optional(),
    assignees: assigneeList.optional(),
  }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("complete") }),
  z.object({
    action: z.literal("assign"),
    assigneeEmail: z.string().email().optional(),
    assignees: assigneeList.optional(),
  }),
  z.object({
    action: z.literal("reassign"),
    assigneeEmail: z.string().email().optional(),
    assignees: assigneeList.optional(),
  }),
  z.object({ action: z.literal("move"), status: z.enum(["open", "in_progress", "done"]) }),
  z.object({ action: z.literal("delete") }),
]);

export type TransitionInput = z.infer<typeof TransitionInput>;

export const CommentBodyShape = { body: z.string().max(10_000) };
export const CommentBodyInput = z.object(CommentBodyShape);
export type CommentBodyInput = z.infer<typeof CommentBodyInput>;

/**
 * The raw shapes the MCP tools register with.
 *
 * They exist because `TransitionInput` is a discriminated union and the MCP
 * SDK's `inputSchema` takes a flat shape, so a union cannot be handed to it
 * directly. These describe the tool's surface; the union above still does the
 * real validation, because the tool hands its arguments to the same service
 * function the route does and that function parses them itself.
 *
 * The split into two tools is D7's one-tool-per-operation, not two authorization
 * models: `tasks_update` carries the assigning actions and `tasks_transition`
 * carries the lifecycle ones, so each can annotate itself honestly rather than
 * one read-and-write tool claiming both.
 */

const taskId = z.string().describe("The task's id.");

export const TaskIdShape = { id: taskId };

export const UpdateTaskShape = {
  id: taskId,
  action: z.enum(["assign", "reassign"]).describe(
    "assign puts a proposed task on somebody; reassign moves one already underway.",
  ),
  assigneeEmail: z.string().email().optional().describe("One assignee. Means a list of one."),
  assignees: assigneeList.optional().describe("The full list of assignees, up to 20."),
};

export const TransitionTaskShape = {
  id: taskId,
  action: z.enum(["accept", "dismiss", "complete", "move", "delete"]).describe(
    "accept and dismiss triage a proposed task; complete finishes your own; move sets a board column; " +
      "delete retires a task you created.",
  ),
  assignee: z.string().email().optional().describe("On accept: who is taking it. Means a list of one."),
  assignees: assigneeList.optional().describe("On accept: the full list, up to 20."),
  status: z.enum(["open", "in_progress", "done"]).optional().describe("On move: the column to move to."),
};

export const TaskCommentListShape = { taskId };
export const TaskCommentAddShape = { taskId, ...CommentBodyShape };
export const TaskCommentDeleteShape = { taskId, commentId: z.string().describe("The comment's id.") };

import { toolResult } from "@/lib/service/mcp";
import type { McpToolDefinition } from "@/lib/service/tool-def";
import { addTaskComment, deleteTaskComment, listTaskComments } from "./service/comments";
import { TaskCommentAddShape, TaskCommentDeleteShape, TaskCommentListShape } from "./service/schemas";

/**
 * Reading and writing a task's comment thread.
 *
 * Three tools, not four. There is no `tasks_comment_edit`: D7's table lists
 * none, so rewriting a comment stays a browser action. Editing is the one
 * operation here whose authorship rule is asymmetric (an author may rewrite
 * their own, an administrator may remove anybody's, and nobody may rewrite
 * somebody else's and leave it attributed to them), and an agent is a poor place
 * to put a rewrite that keeps a person's name on it.
 *
 * Access is whatever opens the task itself, which is why `capability` is `null`
 * here too: if you can read the task you can read and write its thread, and the
 * comment routes check no role either. Deleting somebody else's comment does
 * need `manageAccess`, and the service checks that itself, per call.
 */
export function taskCommentTools(): McpToolDefinition[] {
  return [
    {
      name: "tasks_comment_list",
      description:
        "Read the comment thread on a task you can see, oldest first. A task you cannot see reads as not " +
        "found rather than as a refusal.",
      inputSchema: TaskCommentListShape,
      annotations: { title: "List task comments", readOnlyHint: true, openWorldHint: false },
      capability: null,
      handler: (ctx, args) => toolResult(listTaskComments(ctx, String(args.taskId ?? ""))),
    },
    {
      name: "tasks_comment_add",
      description:
        "Add a comment to a task you can see, attributed to you. Up to 10,000 characters; an empty comment " +
        "is refused.",
      inputSchema: TaskCommentAddShape,
      annotations: {
        title: "Comment on a task",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      capability: null,
      handler: (ctx, args) => toolResult(addTaskComment(ctx, String(args.taskId ?? ""), args)),
    },
    {
      name: "tasks_comment_delete",
      description:
        "Delete a comment. Yours to delete; somebody else's needs the role that administers access.",
      inputSchema: TaskCommentDeleteShape,
      annotations: {
        title: "Delete a task comment",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      capability: null,
      handler: (ctx, args) =>
        toolResult(deleteTaskComment(ctx, String(args.taskId ?? ""), String(args.commentId ?? ""))),
    },
  ];
}

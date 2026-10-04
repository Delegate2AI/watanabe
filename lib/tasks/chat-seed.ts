import type { TaskRecord } from "@/lib/db/tasks";

export interface ChatSeedContext {
  /**
   * The assignee's display name, resolved server-side through `resolvePerson`.
   *
   * The address stays in the line either way: the agent may need to act on it,
   * and a name alone is ambiguous when two people share one. Absent (or with
   * `PEOPLE_ENABLED` off) the line is byte-identical to what it was before the
   * directory existed.
   */
  assigneeName?: string;
}

/**
 * The seed message for "Discuss in chat" from a task (spec 21 + spec 11).
 *
 * It gives the agent the task's context and, for a meeting-derived task, the
 * path of the source meeting note so the agent grounds itself by reading it with
 * its KB tools, rather than us pasting the note's contents. A manual task (spec
 * 2026-07-14) has no source note, so the seed omits it and drops the meeting
 * framing. A richer spec-11 attachment can layer on later; this is the
 * deterministic starting point.
 *
 * Pure: no `node:` import and no directory read, because this runs in the
 * browser from the task card's click handler. Anything about a person arrives
 * already resolved in `context`.
 */
export function taskChatSeed(task: TaskRecord, context: ChatSeedContext = {}): string {
  const fromMeeting = task.sourceNotePath !== null;
  const lines = [
    fromMeeting ? `I want to work on this action item from a meeting.` : `I want to work on this task.`,
    ``,
    `Task: ${task.title}`,
  ];
  if (task.description.trim()) lines.push(task.description.trim());
  if (fromMeeting) lines.push(``, `Source meeting note: ${task.sourceNotePath}`);
  if (task.due) lines.push(`Due: ${task.due}`);
  if (task.assigneeEmail) {
    const name = context.assigneeName?.trim();
    lines.push(
      name && name !== task.assigneeEmail
        ? `Assignee: ${name} (${task.assigneeEmail})`
        : `Assignee: ${task.assigneeEmail}`,
    );
  }
  lines.push(
    ``,
    fromMeeting
      ? `Please read the source note for context, then help me get this done.`
      : `Please help me get this done.`,
  );
  return lines.join("\n");
}

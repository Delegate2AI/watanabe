import { isFlagEnabled } from "@/lib/config/flags";

export function isTasksEnabled(): boolean {
  return isFlagEnabled("TASKS_ENABLED");
}

export function isTaskCommentsEnabled(): boolean {
  return isFlagEnabled("TASK_COMMENTS_ENABLED");
}

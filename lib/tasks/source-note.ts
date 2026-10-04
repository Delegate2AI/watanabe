/**
 * Whether a viewer can open the meeting note a task came from.
 *
 * Attendance grants the TASK, not the note. The KB is served from a
 * clearance-filtered projection (`vaultRootFor`), so an attendee the task's
 * clearance does not cover has no such note in their projection and the "Source
 * meeting" link would lead nowhere. The task text stands on its own; the link
 * is simply omitted for them.
 *
 * Pure, and free of any node-only import, so the client cards can call it.
 */
export function canReadSourceNote(taskClearance: string[], viewerClearance: string[]): boolean {
  const viewer = new Set(viewerClearance);
  return taskClearance.some((group) => viewer.has(group));
}

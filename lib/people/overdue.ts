import type { TaskRecord } from "@/lib/db/tasks";

/**
 * The one definition of "overdue", shared by the list roll-up and the person
 * page.
 *
 * It lives in its own module because the two surfaces MUST agree: a task the
 * dashboard counts in someone's Overdue column has to appear in that person's
 * Overdue group when the viewer clicks through. Two copies of a one-line
 * predicate is exactly the kind of thing that drifts and then quietly makes the
 * page contradict itself.
 */

/**
 * Today as `YYYY-MM-DD`, the granularity an overdue comparison actually works at.
 *
 * Built from the LOCAL date parts, not `toISOString()`. UTC rolls over hours
 * before local midnight in western timezones, so at 22:00 EDT on the 4th the UTC
 * day is already the 5th and a task due the 4th would count as overdue here
 * while `formatDue` in `lib/ui/date.ts` still labels it "due today". That
 * function compares local day parts (see `dayDelta`), and a dashboard count that
 * disagrees with the date printed on the task itself is worse than either rule
 * on its own.
 */
export function todayFrom(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Past due and not finished. `due` may be a bare date or a full instant, so the
 * first ten characters are taken as the calendar day either way: "before today"
 * is a day comparison, not an instant one, and a task due today is not overdue.
 *
 * `dismissed` is not checked here because `getBoardTasks` has already removed
 * those rows before either caller sees them.
 */
export function isTaskOverdue(task: TaskRecord, today: string): boolean {
  return task.status !== "done" && task.due !== null && task.due.slice(0, 10) < today;
}

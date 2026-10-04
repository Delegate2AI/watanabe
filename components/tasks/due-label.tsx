import { formatDateTime, formatDue } from "@/lib/ui/date";

/**
 * A task's due date, in the one form the app uses everywhere.
 *
 * Four surfaces render a due date (the list card, the board card, the project
 * card's task list, and the task detail page), and all four used to call
 * `toLocaleDateString("en-US")`, which said `7/24/2026` and made a task due
 * last Saturday look exactly like one due next week. `formatDue` answers both
 * questions at once: how far away it is, and whether it has already passed.
 *
 * Presentational and pure (`lib/ui/date` has no `node:` import), so a server
 * page and a client card can both render it.
 */
export function DueLabel({
  due,
  prefix = "",
  className = "",
  children,
}: {
  due: string;
  /** Leading text, for a surface that has no icon to say what the date is. */
  prefix?: string;
  className?: string;
  /** An icon rendered before the label. */
  children?: React.ReactNode;
}) {
  const { label, isOverdue } = formatDue(due);
  return (
    <time
      dateTime={due}
      // The exact day stays one hover away, so a relative label never costs
      // precision.
      title={formatDateTime(due)}
      className={`${isOverdue ? "font-medium text-warn" : ""} ${className}`.trim()}
    >
      {children}
      {prefix}
      {label}
    </time>
  );
}

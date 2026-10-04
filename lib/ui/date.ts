/**
 * The app's date presentation: one absolute form, one relative form, one due
 * form. Raw `toLocaleDateString()` gave `7/24/2026` on a task card and
 * `7/15/2026, 5:00:00 AM` in version history, both machine formats, and a task
 * due last Saturday looked identical to one due next week.
 *
 * Deliberately pure: no `node:` imports and no I/O, so a client component can
 * import it. `now` is always injectable so a caller (and a test) can pin it,
 * and month names are spelled out here rather than delegated to the host
 * locale, so a server render and a client render never disagree.
 *
 * Nothing here throws. An unparseable input comes back as the raw string, never
 * "Invalid Date".
 */

export type DateInput = string | number | Date | null | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Beyond this many days in either direction, a relative label stops helping. */
const RELATIVE_WINDOW_DAYS = 30;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** The input as the caller wrote it, for the "leave it alone" fallback. */
function raw(value: DateInput): string {
  if (value == null) return "";
  if (!(value instanceof Date)) return String(value);
  // toISOString throws RangeError on an invalid Date, which would turn the
  // "leave unparseable input alone" fallback into the crash it exists to avoid.
  return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
}

/**
 * A date-only string (`2026-07-18`) is a calendar day, so it is read as local
 * midnight. Reading it as UTC (the JS default) renders the day before in any
 * western timezone, which is how a due date ends up looking a day early.
 */
function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed =
    typeof value === "string" && DATE_ONLY.test(value.trim())
      ? new Date(`${value.trim()}T00:00:00`)
      : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** True when the input names a day with no time of its own. */
function isDateOnly(value: DateInput): boolean {
  return typeof value === "string" && DATE_ONLY.test(value.trim());
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function absolute(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Whole calendar days from `now` to `date`, positive for the future. */
function dayDelta(date: Date, now: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / MS_PER_DAY);
}

/** The absolute day: `23 Jul 2026`. */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? absolute(date) : raw(value);
}

/**
 * The absolute day plus the time of day: `15 Jul 2026, 05:00`. Use it for the
 * `title` attribute on a relative label, so precision stays one hover away. An
 * input that names only a day keeps only the day.
 */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return raw(value);
  if (isDateOnly(value)) return absolute(date);
  return `${absolute(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `today`, `tomorrow`, `yesterday`, `in 3 days`, `3 days ago`, falling back to
 * the absolute day beyond a month in either direction.
 */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return raw(value);

  const days = dayDelta(date, now);
  if (Math.abs(days) > RELATIVE_WINDOW_DAYS) return absolute(date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export interface DueLabel {
  /** The relative form, for display. */
  label: string;
  /** True when the day has already passed. The caller styles it. */
  isOverdue: boolean;
}

/**
 * A due date's label plus whether it has passed. Overdue is a calendar-day
 * comparison, not an instant one: a task due today is due today all day, and an
 * unparseable due date is never overdue.
 */
export function formatDue(value: DateInput, now: Date = new Date()): DueLabel {
  const date = toDate(value);
  if (!date) return { label: raw(value), isOverdue: false };
  return { label: formatRelative(date, now), isOverdue: dayDelta(date, now) < 0 };
}

import type { LlmPeriod } from "./types";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar periods in UTC; a week starts on Monday. */
export function periodBounds(period: LlmPeriod, now: Date): { start: string; resetAt: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  let start: Date;
  let next: Date;
  if (period === "day") {
    start = new Date(Date.UTC(y, m, d));
    next = new Date(Date.UTC(y, m, d + 1));
  } else if (period === "week") {
    const sinceMonday = (now.getUTCDay() + 6) % 7;
    start = new Date(Date.UTC(y, m, d - sinceMonday));
    next = new Date(Date.UTC(y, m, d - sinceMonday + 7));
  } else {
    start = new Date(Date.UTC(y, m, 1));
    next = new Date(Date.UTC(y, m + 1, 1));
  }
  return { start: isoDay(start), resetAt: next.toISOString() };
}

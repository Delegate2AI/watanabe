import { readFrontmatter } from "@/lib/index/frontmatter";

/**
 * Display-title helpers for the KB view, layered on `lib/kb/note.ts`.
 *
 * Presentation only, same contract as `humanize.ts`: no route slug, path, or
 * backlink key is ever derived from anything here.
 */

/** Everything before the KB-TAG close, capped so a long note is not rescanned. */
const TAG_SCAN = 2048;
const TAG_BLOCK = /<!--\s*KB-TAG\b([\s\S]*?)-->/;
const TAG_FIELD = /^\s*kb\.([a-z_]+):\s*(.*?)\s*$/;

export function readKbTag(content: string): Record<string, string> {
  const block = TAG_BLOCK.exec(content.slice(0, TAG_SCAN));
  if (!block) return {};
  const fields: Record<string, string> = {};
  for (const line of block[1].split(/\r?\n/)) {
    const field = TAG_FIELD.exec(line);
    if (field && field[2] !== "" && field[2] !== "-") fields[field[1]] = field[2];
  }
  return fields;
}

export function kbTagTitle(content: string, relPath: string): string | undefined {
  const title = readKbTag(content).title;
  if (!title || !title.includes(" ")) return undefined;
  const stem = (relPath.split("/").pop() ?? relPath).replace(/\.md$/i, "");
  return title === stem ? undefined : title;
}

/**
 * A heading is markdown, a title is text. `**I. Executive Summary**` reaches the
 * tree with its asterisks intact, because the title is lifted from the heading
 * source and never rendered. Single `*` and `_` are left alone: they carry no
 * emphasis on their own and stripping them would eat `INSIGHT_LABS_OS_v1`.
 */
export function plainHeading(heading: string): string {
  return heading
    .replace(/`/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Which rendering of a meeting stamp a surface wants. */
export type StampStyle = "full" | "short";

/**
 * "2026-08-18T12:02:08.300Z" -> "2026-08-18 12:02 UTC" (full) or "18 Aug 12:02"
 * (short). Null on anything unparseable.
 *
 * Full: day first and zero-padded so a column of these reads in the order it
 * sorts. The zone is spelled out: the ingest stamps `date:` in UTC and the
 * tree is rendered on the server, so there is no viewer clock to convert to,
 * and an unlabelled 12:02 would read as local time.
 *
 * Short: for a column too narrow to hold the full stamp and a title (the KB
 * sidebar is 256px). The year is dropped because a meeting note sits in its
 * year folder, and the zone because the surface keeps the full stamp one
 * hover away. Day stays zero-padded so the column lines up.
 */
function dateTimeStamp(value: string, style: StampStyle): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (style === "short") return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${time}`;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${day} ${time} UTC`;
}

/**
 * The instant a meeting note is dated by, as a normalized UTC ISO string, or
 * null for anything that is not a dated, parseable meeting note. This is the
 * sort key the KB tree and KB search order meeting notes by. It is re-emitted
 * through `toISOString` rather than returned as written, so a plain string
 * comparison stays chronological even if a note ever carries an offset or
 * drops the milliseconds.
 */
export function meetingDateKey(content: string): string | null {
  const { fields } = readFrontmatter(content);
  if (fields.type !== "meeting") return null;
  const raw = fields.date;
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function withMeetingDate(title: string, content: string, style: StampStyle = "full"): string {
  const key = meetingDateKey(content);
  const stamp = key ? dateTimeStamp(key, style) : null;
  return stamp ? `${stamp} · ${title}` : title;
}

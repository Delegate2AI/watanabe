import { parseDoc, readFrontmatter } from "@/lib/index/frontmatter";
import { readVisibility } from "@/lib/authority/visibility";
import { humanizeStem } from "./humanize";
import { kbTagTitle, plainHeading } from "./doc-title";

/**
 * Note metadata for the KB view (spec 25): the frontmatter header fields plus a
 * collapsed visibility (`all-hands` vs `restricted`) and a prettified group
 * label for the `VisibilityChip`.
 *
 * A note only ever reaches this code if it is in the requester's projection
 * (spec 19), so a `restricted` value here always means "restricted and you are
 * cleared", never "you cannot open this". Absence, not this field, is the
 * clearance boundary.
 */
export interface NoteMeta {
  title: string;
  type?: string;
  updated?: string;
  owner?: string;
  visibility: "all-hands" | "restricted";
  /** Prettified restricting group (e.g. "Exec"), present only when restricted. */
  group?: string;
  /**
   * The whole-note citation, e.g. `circleback:<meeting id>` on an ingested
   * meeting note. For a meeting note it is exactly the `source_meeting_id` its
   * tasks carry, which is how the "Action items" panel finds them (spec
   * 2026-08-17-kb-task-links-design).
   */
  source?: string;
}

export interface Note extends NoteMeta {
  body: string;
}

function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** "exec" -> "Exec", "board-members" -> "Board Members". */
function prettyGroup(group: string): string {
  return group
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The body markdown, everything after the closing frontmatter fence. */
export function splitBody(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return content;
  const closeIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closeIndex === -1) return content;
  return lines.slice(closeIndex + 2).join("\n");
}

/**
 * `parseDoc` falls back to the bare file stem with separators turned into
 * spaces ("quarterly notes") when a note carries neither a frontmatter title
 * nor a body heading. For display we want that humanized ("Quarterly Notes").
 *
 * Comparing the parsed title against the fallback string is not enough to know
 * we are looking at the fallback: a note deliberately titled "quarterly notes"
 * in its frontmatter produces the same string, and rewriting that would be
 * overriding an author. So check whether the note actually has an authored
 * title first, and only humanize when it has neither.
 */
function displayTitle(relPath: string, parsedTitle: string, authored: boolean): string {
  if (authored) return parsedTitle;
  const stem = (relPath.split("/").pop() ?? relPath).replace(/\.md$/i, "");
  const bareFallback = stem.replace(/[-_]/g, " ");
  return parsedTitle === bareFallback ? humanizeStem(relPath) : parsedTitle;
}

export function noteMetaFromContent(relPath: string, content: string): NoteMeta {
  const { fields } = readFrontmatter(content);
  const { title: parsedTitle } = parseDoc(relPath, content);
  // An authored title is either a frontmatter `title:` or a body heading.
  // Either way the words are the author's, so they are rendered as written.
  const yamlTitle = stringField(fields, "title");
  const authored = Boolean(yamlTitle) || /^\s{0,3}#\s+\S/m.test(splitBody(content));
  const parsed = displayTitle(relPath, parsedTitle, authored);
  // A frontmatter title is the author naming the note, so it wins outright.
  // Otherwise `kb.title` (DL-037) gets to name a note whose first heading is not
  // one, and a heading-derived title is stripped back to text before display.
  const title = yamlTitle ? parsed : (kbTagTitle(content, relPath) ?? plainHeading(parsed));

  const visibilityGroups = readVisibility(content);
  const restrictingGroup =
    visibilityGroups === "unparseable"
      ? undefined
      : visibilityGroups.find((group) => group !== "all-hands");

  return {
    title,
    type: stringField(fields, "type"),
    updated: stringField(fields, "updated"),
    owner: stringField(fields, "owner"),
    visibility: restrictingGroup ? "restricted" : "all-hands",
    group: restrictingGroup ? prettyGroup(restrictingGroup) : undefined,
    source: stringField(fields, "source"),
  };
}

export function parseNote(relPath: string, content: string): Note {
  return { ...noteMetaFromContent(relPath, content), body: splitBody(content) };
}

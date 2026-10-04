import { kbSearch } from "@/lib/kb-mcp/tools";
import { readVaultFile } from "@/lib/vault";
import { meetingDateKey, withMeetingDate } from "./doc-title";
import { noteMetaFromContent } from "./note";
import { dropTitleHeading, snippetFor, stripFrontmatter, toPlainText } from "./snippet";

/**
 * Clearance-scoped KB search (spec 25).
 *
 * Reuses the same `kb_search` backend the agent uses, scoped to
 * `vaultRootFor(clearance)` via the `scopeRoot` argument. The backend only ever
 * walks that projection root, so a restricted match is physically unreachable:
 * absence is the boundary, no per-result visibility filter is applied here.
 * Results are collapsed to one row per note and enriched with the note's title
 * and visibility for the result card.
 *
 * The backend greps raw source, so its match may well be a frontmatter line. A
 * note that merely lists someone as its `owner:` is not a search result for
 * that person's name, so matching is re-checked here against the body and the
 * parsed title only, and the snippet is cut from rendered plaintext rather than
 * from source (see `./snippet`).
 */
export interface KbSearchRow {
  /** Extensionless route slug string. */
  route: string;
  relPath: string;
  title: string;
  visibility: "all-hands" | "restricted";
  group?: string;
  snippet: string;
  /** Offsets of the matched term within `snippet`, for the result card to mark. */
  matchStart: number;
  matchEnd: number;
}

/** `relPath:line: snippet` is the backend's line format. */
const MATCH_LINE = /^(.+?):(\d+): (.*)$/;

function firstText(result: Awaited<ReturnType<typeof kbSearch>>): string {
  if (result.isError) return "";
  const first = result.content?.[0];
  return first && first.type === "text" ? first.text : "";
}

/** The notes the backend matched, in backend order, one entry per note. */
function matchedPaths(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const match = MATCH_LINE.exec(line);
    if (!match) continue;
    const relPath = match[1];
    if (!relPath.toLowerCase().endsWith(".md")) continue; // KB view renders .md pages only
    seen.add(relPath);
  }
  return [...seen];
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export async function searchKb(query: string, root: string): Promise<KbSearchRow[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const needle = trimmed.toLowerCase();

  const text = firstText(await kbSearch({ query: trimmed }, root));

  const rows: { row: KbSearchRow; titleMatch: boolean; dateKey: string | null }[] = [];
  for (const relPath of matchedPaths(text)) {
    const content = readVaultFile(relPath, root) ?? "";
    const meta = noteMetaFromContent(relPath, content);

    // Match against the body and the title, never the frontmatter block. The
    // raw body (not the reduced plaintext) is what decides, so a match inside a
    // link target or a code span still counts as a hit.
    const body = stripFrontmatter(content);
    const titleMatch = contains(meta.title, needle);
    if (!titleMatch && !contains(body, needle)) continue;

    // The card already renders the title, so the body's own repeat of it is not
    // snippet material.
    const snippet = snippetFor(toPlainText(dropTitleHeading(body, meta.title)), trimmed);
    rows.push({
      titleMatch,
      dateKey: meetingDateKey(content),
      row: {
        route: relPath.replace(/\.md$/i, ""),
        relPath,
        // Dated for the same reason the tree dates it: a results column of
        // identical meeting titles identifies nothing.
        title: withMeetingDate(meta.title, content),
        visibility: meta.visibility,
        group: meta.group,
        snippet: snippet.text,
        matchStart: snippet.matchStart,
        matchEnd: snippet.matchEnd,
      },
    });
  }

  // A note the query names is a better answer than one that mentions it.
  const ranked = rows
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || a.index - b.index);

  // The backend walks the vault in directory order, so twenty instances of one
  // recurring meeting come back shuffled. Within each rank band, put the dated
  // meeting rows in newest-first order across the slots they already hold, so
  // their rank against every other note is unchanged and only their order
  // among themselves is. Per band, or a newer body-only meeting would swap
  // into the slot of an older one the query names.
  for (const band of [true, false]) {
    const slots = ranked.flatMap((entry, index) =>
      entry.titleMatch === band && entry.dateKey ? [index] : [],
    );
    const byDate = slots
      .map((index) => ranked[index])
      .sort((a, b) => (b.dateKey ?? "").localeCompare(a.dateKey ?? ""));
    slots.forEach((slot, i) => {
      ranked[slot] = byDate[i];
    });
  }
  return ranked.map((entry) => entry.row);
}

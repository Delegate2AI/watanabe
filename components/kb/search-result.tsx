import Link from "next/link";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import type { KbSearchRow } from "@/lib/kb/search";

/**
 * One KB search result (spec 25): title, path, VisibilityChip, and a matched
 * snippet with the query marked. The row only exists because the note is in the
 * requester's projection, so a restricted chip here always means "restricted,
 * and you are cleared".
 */

/** The snippet with the matched term marked. Zero-width offsets render plainly. */
function MarkedSnippet({ row }: { row: KbSearchRow }) {
  if (row.matchEnd <= row.matchStart) return <>{row.snippet}</>;
  return (
    <>
      {row.snippet.slice(0, row.matchStart)}
      <mark className="rounded-sm bg-accent-soft px-0.5 text-ink">
        {row.snippet.slice(row.matchStart, row.matchEnd)}
      </mark>
      {row.snippet.slice(row.matchEnd)}
    </>
  );
}

export function SearchResult({ row }: { row: KbSearchRow }) {
  return (
    <li className="rounded-menu border border-line-soft p-3 hover:border-line">
      <Link href={`/kb/${row.route.split("/").map(encodeURIComponent).join("/")}`} className="block">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-ink">{row.title}</span>
          {row.visibility === "restricted" && (
            <VisibilityChip visibility="restricted" group={row.group} />
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-faint">{row.relPath}</div>
        <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-muted">
          <MarkedSnippet row={row} />
        </p>
      </Link>
    </li>
  );
}

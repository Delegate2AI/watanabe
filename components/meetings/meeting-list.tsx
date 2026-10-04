"use client";

import { useState } from "react";
import { ListTextFilter, NoMatches, useTextFilter } from "@/components/list-text-filter";
import { MeetingRow, type MeetingReclearAccess } from "./meeting-row";
import type { MeetingListItem } from "@/lib/meetings/list";
import type { Person } from "@/lib/people/types";

export interface MeetingListEntry {
  meeting: MeetingListItem;
  /** Present only when the viewer is an admin and AUTHORITY_ENABLED is on. */
  reclear?: MeetingReclearAccess;
  /** The viewer is on this meeting's attendee list. Resolved server-side through the alias registry. */
  attended?: boolean;
}

type Scope = "mine" | "all";

const SEGMENT = "rounded-md px-3 py-1.5 text-sm font-medium";

/**
 * The `/meetings` list with its scope toggle and text filter (surface-polish
 * P-12g). Rows arrive already clearance-scoped from the server page; both
 * controls only narrow what is on screen, the toggle to meetings the viewer
 * attended, the filter over the title and the clearing group.
 */
export function MeetingList({
  entries,
  people,
}: {
  entries: MeetingListEntry[];
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people: Record<string, Person>;
}) {
  const mineCount = entries.filter((e) => e.attended).length;
  const [scope, setScope] = useState<Scope>(mineCount > 0 ? "mine" : "all");
  const { query, setQuery, matches } = useTextFilter();
  const inScope = entries.filter((e) => scope === "all" || e.attended);
  const visible = inScope.filter((e) => matches(`${e.meeting.title} ${e.meeting.group ?? ""}`));

  const segments: { scope: Scope; label: string; count: number }[] = [
    { scope: "mine", label: "My meetings", count: mineCount },
    { scope: "all", label: "All", count: entries.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListTextFilter label="Filter meetings" placeholder="Filter meetings" value={query} onChange={setQuery} />
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Meeting scope">
          {segments.map((segment) => (
            <button
              key={segment.scope}
              type="button"
              role="tab"
              aria-selected={scope === segment.scope}
              onClick={() => setScope(segment.scope)}
              className={`${SEGMENT} ${scope === segment.scope ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
            >
              {segment.label} {segment.count}
            </button>
          ))}
        </div>
      </div>
      {inScope.length === 0 ? (
        <p className="text-sm text-ink-muted">
          None of the meetings you are cleared for list you as an attendee.
        </p>
      ) : visible.length === 0 ? (
        <NoMatches noun="meetings" />
      ) : (
        <ul className="grid gap-3">
          {visible.map((e) => (
            <li key={e.meeting.href}>
              <MeetingRow meeting={e.meeting} people={people} reclear={e.reclear} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

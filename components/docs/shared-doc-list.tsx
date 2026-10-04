"use client";

import { DocCard } from "@/components/kit/doc-card";
import { ListTextFilter, NoMatches, useTextFilter } from "@/components/list-text-filter";
import { PersonChip, personFor } from "@/components/person-chip";
import type { Person } from "@/lib/people/types";
import { formatDateTime, formatRelative } from "@/lib/ui/date";
import { AccessPill } from "./access-pill";
import type { SharedAccess } from "@/lib/shared-docs/types";

export interface OwnedDocCard {
  id: string;
  title: string;
  updatedAt: string;
}
export interface SharedWithMeCard {
  id: string;
  title: string;
  ownerEmail: string;
  access: SharedAccess;
  updatedAt: string;
}

function UpdatedLabel({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      Updated {formatRelative(iso)}
    </time>
  );
}

/**
 * The `/docs` surface body (spec 28): two groups, "Shared by me" and "Shared
 * with me". Each card links to the detail view; a "with me" card carries the
 * owner and the recipient's access pill.
 *
 * One filter box narrows BOTH groups (surface-polish P-12g), client-side over
 * the already-loaded set: both lists are fetched owner/recipient-scoped by the
 * server page, so a row that is filtered out was never a row someone else could
 * see. `people` is resolved server-side because `<PersonChip>` takes an
 * already-resolved person; an unresolved address renders as itself.
 */
export function SharedDocList({
  sharedByMe,
  sharedWithMe,
  people = {},
}: {
  sharedByMe: OwnedDocCard[];
  sharedWithMe: SharedWithMeCard[];
  people?: Record<string, Person>;
}) {
  const { query, setQuery, matches } = useTextFilter();
  const owned = sharedByMe.filter((d) => matches(d.title));
  const received = sharedWithMe.filter((d) => matches(`${d.title} ${d.ownerEmail}`));

  return (
    <div className="flex flex-col gap-10">
      <ListTextFilter label="Filter shared docs" placeholder="Filter documents" value={query} onChange={setQuery} />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Shared by me</h2>
        {sharedByMe.length === 0 ? (
          <p className="text-sm text-ink-muted">
            You are not sharing any documents yet. Use New document above, then add people who can view,
            comment, or edit.
          </p>
        ) : owned.length === 0 ? (
          <NoMatches noun="documents" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {owned.map((d) => (
              <li key={d.id} className="flex flex-col gap-2">
                <DocCard href={`/docs/${d.id}`} title={d.title} subtitle={<UpdatedLabel iso={d.updatedAt} />} />
                <div className="pl-1">
                  <AccessPill access="owner" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Shared with me</h2>
        {sharedWithMe.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing has been shared with you yet.</p>
        ) : received.length === 0 ? (
          <NoMatches noun="documents" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {received.map((d) => (
              <li key={d.id} className="flex flex-col gap-2">
                <DocCard
                  href={`/docs/${d.id}`}
                  title={d.title}
                  subtitle={
                    <>
                      From <PersonChip person={personFor(people, d.ownerEmail.trim().toLowerCase())} />
                    </>
                  }
                />
                <div className="flex items-center gap-3 pl-1 text-xs text-ink-muted">
                  <AccessPill access={d.access} />
                  <UpdatedLabel iso={d.updatedAt} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

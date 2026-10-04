"use client";

import { Users } from "lucide-react";
import { PersonChip, personFor } from "@/components/person-chip";
import type { Person } from "@/lib/people/types";
import type { DocShare, ShareOptions, ShareRecipientKind } from "@/lib/shared-docs/types";

/**
 * Rendering and addressing for one share recipient, person or team.
 *
 * Split out of `share-manager.tsx` so that file stays under the size limit and
 * keeps to state + fetching. Everything here is presentational except
 * {@link recipientKey}/{@link parseRecipientKey}, which are the one encoding of
 * a recipient into a `<select>` value.
 */

export const ALL_HANDS_TEAM = "all-hands";

/**
 * A recipient as one option value. Kind is carried in the string rather than
 * inferred from shape at read time: an email and a group name are only
 * distinguishable by convention, and letting the UI guess is how a team named
 * like an address would silently become a person grant.
 */
export function recipientKey(kind: ShareRecipientKind, recipient: string): string {
  return `${kind}:${recipient}`;
}

export function parseRecipientKey(
  value: string,
): { kind: ShareRecipientKind; recipient: string } | null {
  const split = value.indexOf(":");
  if (split <= 0) return null;
  const kind = value.slice(0, split);
  const recipient = value.slice(split + 1);
  if (recipient === "") return null;
  if (kind !== "user" && kind !== "group") return null;
  return { kind, recipient };
}

/** How a team names itself in the picker and in a share row. */
export function teamLabel(name: string, memberCount: number | null): string {
  if (name === ALL_HANDS_TEAM) return "Everyone";
  if (memberCount === null) return name;
  return `${name} (${memberCount} ${memberCount === 1 ? "person" : "people"})`;
}

/**
 * A team, rendered to match `<PersonChip variant="avatar">` so a share list of
 * mixed rows reads as one list rather than two.
 */
export function TeamChip({
  name,
  memberCount = null,
  className = "",
}: {
  name: string;
  memberCount?: number | null;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted"
      >
        <Users className="size-3.5" />
      </span>
      <span className="truncate">{teamLabel(name, memberCount)}</span>
    </span>
  );
}

/** The label for one existing share row, dispatched on its recipient kind. */
export function ShareRecipientLabel({
  share,
  people,
  teamCounts,
}: {
  share: DocShare;
  people: Record<string, Person>;
  teamCounts: Record<string, number | null>;
}) {
  if (share.recipientKind === "group") {
    return (
      <TeamChip
        name={share.recipient}
        // A team can be shared with and later dropped from groups.yaml, or be one
        // this viewer cannot enumerate. Undefined means "count unknown", which
        // renders as the bare name rather than a wrong "(0 people)".
        memberCount={share.recipient in teamCounts ? teamCounts[share.recipient] : null}
        className="min-w-0 text-ink"
      />
    );
  }
  return (
    <PersonChip
      person={personFor(people, share.recipient.trim().toLowerCase())}
      variant="avatar"
      className="min-w-0 text-ink"
    />
  );
}

/**
 * The "who are you adding" control: one grouped `<select>` of teams and people.
 *
 * Free-text entry is deliberately gone. It let a typo write a share row aimed at
 * an address nobody owns, which looks identical to a working grant, and it can
 * express nothing the directory does not already list.
 */
export function ShareRecipientSelect({
  id,
  options,
  value,
  disabled,
  onChange,
}: {
  id: string;
  options: ShareOptions;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const empty = options.teams.length === 0 && options.people.length === 0;
  return (
    <select
      id={`share-recipient-${id}`}
      value={value}
      disabled={disabled || empty}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Team or person to share with"
      className="min-w-0 flex-1 rounded-chip border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink disabled:opacity-60"
    >
      <option value="">{empty ? "No one to share with yet" : "Add a team or person…"}</option>
      {options.teams.length > 0 && (
        <optgroup label="Teams">
          {options.teams.map((team) => (
            <option key={team.name} value={recipientKey("group", team.name)}>
              {teamLabel(team.name, team.memberCount)}
            </option>
          ))}
        </optgroup>
      )}
      {options.people.length > 0 && (
        <optgroup label="People">
          {options.people.map((option) => (
            <option key={option.email} value={recipientKey("user", option.email)}>
              {option.person.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

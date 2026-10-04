"use client";

import { X } from "lucide-react";
import { PersonChip } from "@/components/person-chip";
import { personFor, personLabel } from "@/components/person-view";
import { MemberOptions } from "./assignee";
import type { Person } from "@/lib/people/types";

/**
 * The assignee control for a task that can be handed to several people.
 *
 * A chip per person already on it, each with a remove button, plus a select
 * that ADDS one. The select is deliberately not a `<select multiple>`: that
 * renders as a scrolling list box, needs modifier-clicking to use, and is
 * unusable on touch. Its options exclude whoever is already chosen, so the
 * list shrinks as people are added and a duplicate cannot be picked.
 *
 * `onChange` receives the whole new list. Callers that write on every change
 * (the board card reassigns immediately) and callers that submit later (the
 * triage card's Accept) both work off that one list.
 */
export function AssigneePicker({
  id,
  label,
  members,
  people,
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  id: string;
  /** The select's accessible name, e.g. "Assignee" or "Reassign". */
  label: string;
  members: string[];
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people: Record<string, Person>;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const available = members.filter((member) => !value.includes(member));

  return (
    <div className={`flex min-w-0 flex-1 flex-wrap items-center gap-1.5 ${className}`}>
      {value.map((email) => (
        <span key={email} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-1 pr-0.5 text-xs">
          <PersonChip person={personFor(people, email)} variant="avatar" />
          <button
            type="button"
            aria-label={`Remove ${personLabel(personFor(people, email), "option")}`}
            disabled={disabled}
            onClick={() => onChange(value.filter((current) => current !== email))}
            className="grid size-5 place-items-center rounded-full text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select
        id={id}
        aria-label={label}
        value=""
        disabled={disabled || available.length === 0}
        onChange={(event) => {
          if (event.target.value) onChange([...value, event.target.value]);
        }}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink disabled:opacity-60"
      >
        <option value="">{value.length > 0 ? "Add someone" : "Unassigned"}</option>
        <MemberOptions members={available} people={people} />
      </select>
    </div>
  );
}

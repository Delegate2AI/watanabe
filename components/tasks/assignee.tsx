import { PersonChip } from "@/components/person-chip";
import { personFor, personLabel } from "@/components/person-view";
import type { Person } from "@/lib/people/types";

/**
 * The two ways a task names a person, shared by every task surface (the list
 * card, the board card, the project card's task list, and the detail page).
 *
 * Both take an ALREADY-RESOLVED directory: `resolvePeople` reads from disk, so
 * it runs on the server page and the result is threaded down as a prop. Keeping
 * these here rather than inlining the same JSX four times is what makes the
 * avatar initials come from one place: `<PersonChip>` renders `person.initials`
 * (first and last word, so "Maria Chen" is "MC"), never a slice of the address.
 */

/** Every assignee as avatar chips, or `emptyLabel` when nobody is assigned. */
export function AssigneeChips({
  emails,
  people,
  className = "",
  emptyLabel = "Needs triage",
}: {
  emails: string[];
  people: Record<string, Person>;
  className?: string;
  emptyLabel?: string;
}) {
  if (emails.length === 0) return <span className={className}>{emptyLabel}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {emails.map((email) => (
        <PersonChip key={email} person={personFor(people, email)} variant="avatar" className={className} />
      ))}
    </span>
  );
}

/** The assignee line: an avatar chip, or `emptyLabel` when unassigned. */
export function AssigneeChip({
  email,
  people,
  className = "",
  emptyLabel = "Needs triage",
}: {
  email: string | null;
  people: Record<string, Person>;
  className?: string;
  /** Settled work is nobody's queue, so a done card says Unassigned instead. */
  emptyLabel?: string;
}) {
  if (!email) return <span className={className}>{emptyLabel}</span>;
  return <PersonChip person={personFor(people, email)} variant="avatar" className={className} />;
}

/**
 * The `<option>` list for an assignee `<select>`.
 *
 * The VALUE stays the raw email, deliberately: `PATCH /api/tasks/[id]` validates
 * the posted assignee against `isKnownMember`, so the wire value must not
 * change. Only the label does, and it keeps the address in parentheses for the
 * viewer's own row so the choice is never ambiguous.
 *
 * Two colleagues can share a display name, and a picker that prints the name
 * alone then offers two rows a viewer cannot tell apart. Any label used more
 * than once carries its address, which is the same disambiguation the viewer's
 * own row already gets. The common case is untouched: a name unique in the list
 * still renders bare.
 */
export function MemberOptions({
  members,
  people,
}: {
  members: string[];
  people: Record<string, Person>;
}) {
  const labels = members.map((member) => personLabel(personFor(people, member), "option"));
  const collisions = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));
  return (
    <>
      {members.map((member, index) => (
        <option key={member} value={member}>
          {collisions.has(labels[index]) ? `${labels[index]} (${member})` : labels[index]}
        </option>
      ))}
    </>
  );
}

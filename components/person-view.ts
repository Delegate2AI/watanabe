import type { Person } from "@/lib/people/types";

/**
 * Pure person-view helpers, deliberately kept OUT of the `"use client"`
 * `person-chip.tsx`. A `"use client"` module's exports are client references, so
 * calling one of these during a server render throws "Attempted to call X() from
 * the server". Server components (for example the project detail page) resolve a
 * person here; `<PersonChip>` renders the resolved value. `person-chip.tsx`
 * re-exports these so client code can keep importing from one place.
 */

export type PersonChipVariant = "inline" | "avatar" | "option" | "named";

/**
 * The text a chip shows. Shared so a native `<option>` label, which must be a
 * plain string, uses the same rule as the rendered chip.
 *
 * "You" collapses the viewer's own name everywhere except a picker, where the
 * address is what gets posted and hiding it would make the choice ambiguous,
 * and the `named` variant, which is for the surfaces that EDIT a name: an admin
 * renaming their own row has to see the name they just typed, not "You".
 */
export function personLabel(person: Person, variant: PersonChipVariant = "inline"): string {
  if (variant === "named") return person.isSelf ? `You (${person.name})` : person.name;
  if (!person.isSelf) return person.name;
  return variant === "option" ? `You (${person.email})` : "You";
}

/**
 * What to render for an address the server did not resolve, for example a row a
 * client component added optimistically. Deliberately identical to what a
 * flag-off `resolvePerson()` returns: the address itself.
 */
export function fallbackPerson(email: string): Person {
  return { email, name: email, initials: email.charAt(0).toUpperCase() || "?", isSelf: false };
}

/** Looks a resolved person up by email, degrading to the address. */
export function personFor(people: Record<string, Person>, email: string): Person {
  return people[email] ?? fallbackPerson(email);
}

/**
 * The candidate list a picker offers: addresses deduped and normalized, each
 * resolved through the map the server already built, sorted by the person's
 * name with the email address as the tiebreak. Falls back to the address for
 * anyone the directory does not know, so a candidate never renders as a blank
 * row.
 */
export function peopleOptions(
  emails: readonly string[],
  people: Record<string, Person>,
): Person[] {
  const seen = new Set<string>();
  const candidates: Person[] = [];

  for (const raw of emails) {
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!email || seen.has(email)) continue;
    seen.add(email);
    candidates.push(personFor(people, email));
  }

  return candidates.sort((a, b) =>
    a.name.localeCompare(b.name)
    || a.email.localeCompare(b.email),
  );
}

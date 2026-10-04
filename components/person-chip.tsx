"use client";

import type { ReactNode } from "react";
import type { Person } from "@/lib/people/types";
import { type PersonChipVariant, personLabel } from "@/components/person-view";

/**
 * The one renderer for a person. Every surface that names someone goes through
 * it, so no screen hand-formats an email again.
 *
 * It takes an ALREADY-RESOLVED `Person` and imports nothing from
 * `lib/people/store.ts` or `lib/people/resolve.ts`: those reach `node:fs`, and
 * a "use client" module that pulls them in fails Turbopack code generation.
 * Server components resolve, this component renders.
 *
 * The pure lookup/label helpers live in `person-view.ts` (no "use client") so a
 * server component can call them without tripping the client-reference guard;
 * they are re-exported here so client code can keep importing from one place.
 */

export { fallbackPerson, peopleOptions, personFor, personLabel } from "@/components/person-view";
export type { PersonChipVariant } from "@/components/person-view";

export function PersonChip({
  person,
  variant = "inline",
  className = "",
}: {
  person: Person;
  variant?: PersonChipVariant;
  className?: string;
}): ReactNode {
  const label = personLabel(person, variant);

  if (variant === "option") return label;

  if (variant === "avatar") {
    return (
      <span className={`inline-flex min-w-0 items-center gap-2 ${className}`} title={person.email}>
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white"
        >
          {person.initials}
        </span>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <span className={`truncate ${className}`} title={person.email}>
      {label}
    </span>
  );
}

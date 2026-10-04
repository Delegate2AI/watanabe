/**
 * Types shared by the people directory's server side and its one renderer.
 *
 * This module deliberately has NO runtime imports. `components/person-chip.tsx`
 * is a "use client" component, so anything it imports gets bundled for the
 * browser: pulling in `lib/people/store.ts` (which reaches `node:fs`) would
 * fail Turbopack code generation. The chip imports its types from here and
 * takes an already-resolved `Person` as a prop.
 */

/** How a directory row got its name. A manual edit is sticky against the IdP. */
export type PersonSource = "idp" | "manual";

/** One row of `access/people.yaml`. */
export interface PersonRecord {
  name: string;
  /** Reserved: parsed and preserved, rendered nowhere yet. */
  title?: string;
  source: PersonSource;
}

/** The parsed directory, keyed by normalized (trimmed, lower-cased) email. */
export type Directory = Record<string, PersonRecord>;

/** A renderable person. Always has a name, even with no directory row. */
export interface Person {
  email: string;
  name: string;
  initials: string;
  isSelf: boolean;
}

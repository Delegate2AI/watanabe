import { resolvePeople } from "@/lib/people/resolve";
import type { Person } from "@/lib/people/types";
import { loadGroups } from "./groups";

export interface VisibilityPerson {
  email: string;
  groups: string[];
  /**
   * The resolved person for the option label. Resolved HERE, on the server:
   * `<VisibilityPicker>` is a client island, so it can render a `Person` but
   * must never look one up.
   */
  person: Person;
}

export interface VisibilityOptions {
  groups: string[];
  people: VisibilityPerson[];
}

/**
 * The groups and people a caller may grant KB visibility to (spec 27 / spec 19).
 *
 * KB visibility is group-based: a published note is filed at group clearance, so
 * the pickable options are group NAMES. We additionally surface the PEOPLE in
 * those groups as a convenience, but a person maps to their groups (picking
 * alice adds alice's groups), so the stored visibility is always groups and
 * still resolves in the clearance model.
 *
 * Scoping: only groups the caller's own clearance includes are offered, plus
 * the always-available `all-hands`. That prevents leaking membership of groups
 * the caller is not cleared for, and means a caller can only publish to groups
 * they belong to. With authority off, `loadGroups()` is empty, so the only
 * option is `all-hands`.
 */
export function visibilityOptionsFor(
  clearance: string[],
  viewerEmail?: string,
  options: { isAdmin?: boolean } = {},
): VisibilityOptions {
  const all = loadGroups();
  const cleared = new Set(clearance);
  // An admin already reads every group's notes and edits every group's
  // membership, so scoping their publish targets to their own memberships hid
  // nothing and only stopped them filing a note where it belongs. For everyone
  // else the scoping is the point: it keeps group membership from leaking and
  // keeps a contributor publishing into groups they are actually in.
  const groups = Object.keys(all)
    .filter((group) => group !== "all-hands" && (options.isAdmin || cleared.has(group)))
    .sort((a, b) => a.localeCompare(b));

  const peopleGroups = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const email of all[group]) {
      if (!peopleGroups.has(email)) peopleGroups.set(email, new Set());
      peopleGroups.get(email)!.add(group);
    }
  }
  const resolved = resolvePeople(
    [...peopleGroups.keys()],
    viewerEmail === undefined ? {} : { viewerEmail },
  );
  const people = [...peopleGroups.entries()]
    .map(([email, gs]) => ({
      email,
      groups: [...gs].sort((a, b) => a.localeCompare(b)),
      person: resolved[email.trim().toLowerCase()] ?? { email, name: email, initials: "?", isSelf: false },
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return { groups: ["all-hands", ...groups], people };
}

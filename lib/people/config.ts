import { isFlagEnabled } from "@/lib/config/flags";

/**
 * People directory feature flag (spec: people directory and identity rendering).
 * Off, no `access/people.yaml` is read or written and `resolvePerson()` hands
 * back the raw email as the display name, so every existing byte-path renders
 * exactly what it renders today. The humanized email local part is part of the
 * flag-ON path on purpose.
 */
export function isPeopleEnabled(): boolean {
  return isFlagEnabled("PEOPLE_ENABLED");
}

/**
 * People activity dashboard feature flag (spec: people activity dashboard).
 * Separate from PEOPLE_ENABLED on purpose: the directory names people, this
 * flag opens the `/people` surface that rotates meetings and tasks by person.
 * Off, `/people` renders the dormant scaffold and the sidebar entry is not
 * rendered at all, so the shell stays byte-identical to today's.
 */
export function isPeopleActivityEnabled(): boolean {
  return isFlagEnabled("PEOPLE_ACTIVITY_ENABLED");
}

/** Relative path of the directory file inside the private access checkout. */
export const PEOPLE_ACCESS_PATH = "access/people.yaml";

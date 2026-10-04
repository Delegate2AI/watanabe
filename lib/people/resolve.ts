import { isPeopleEnabled } from "./config";
import { looksLikeOpaqueId } from "./display-name";
import { loadPeople } from "./store";
import type { Directory, Person } from "./types";

export type { Person } from "./types";

export interface ResolveOptions {
  /** The signed-in viewer, so a person can render as "You". */
  viewerEmail?: string;
  /** A directory already loaded by the caller. Skips the file read. */
  directory?: Directory;
  /** Flag override. Defaults to `isPeopleEnabled()`. */
  enabled?: boolean;
}

function normalizedEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isEmail(value: string): boolean {
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1 && !/\s/.test(value);
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turns an email local part into something a human would recognize:
 * `maria.chen@x` becomes "Maria Chen", `taylor@x` becomes "Taylor". A
 * trailing `+tag` is dropped, since it addresses a mailbox, not a person.
 * Returns an empty string when nothing usable is left, so the caller can fall
 * back to the address itself.
 */
export function humanizeEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split("+")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map(capitalized)
    .join(" ");
}

/**
 * First letter of the first word plus first letter of the last word, so a
 * three-word name still yields two initials rather than three.
 */
export function initialsFor(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Turns an email into something renderable. Never throws and always returns a
 * non-empty `name` for a valid address, so no surface has to hand-format an
 * email or guard against a blank chip.
 *
 * Flag off, the name IS the email and `isSelf` is false: that keeps every
 * migrated surface byte-identical to its pre-spec output, and it is why
 * `<PersonChip>` needs no knowledge of the flag.
 */
export function resolvePerson(email: string, options: ResolveOptions = {}): Person {
  const normalized = normalizedEmail(email);
  const viewer = normalizedEmail(options.viewerEmail);
  try {
    if (!isEmail(normalized)) {
      return { email: normalized, name: normalized, initials: "?", isSelf: false };
    }
    if (!(options.enabled ?? isPeopleEnabled())) {
      return {
        email: normalized,
        name: normalized,
        initials: normalized.charAt(0).toUpperCase(),
        isSelf: false,
      };
    }
    const directory = options.directory ?? loadPeople();
    const record = directory[normalized];
    const stored = record?.name?.trim();
    // A `manual` row is a name an admin typed, so it is honored however odd it
    // looks. An `idp` row holds whatever the identity header carried, which for
    // some providers is an opaque user id: rows written before that was
    // filtered out are distrusted here rather than left to name someone.
    const trusted = stored && (record?.source === "manual" || !looksLikeOpaqueId(stored, normalized))
      ? stored
      : "";
    const humanized = humanizeEmail(normalized);
    // An address whose local part is all separators humanizes to nothing. Show
    // the address rather than a blank chip, and do not fake initials from it.
    const named = trusted || humanized;
    return {
      email: normalized,
      name: named || normalized,
      initials: named ? initialsFor(named) : "?",
      isSelf: normalized === viewer,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[people] failed to resolve ${normalized}: ${message}`);
    return {
      email: normalized,
      name: normalized,
      initials: normalized.charAt(0).toUpperCase() || "?",
      isSelf: false,
    };
  }
}

/**
 * Batch form for list rendering: reads the directory once for the whole set.
 * Keyed by normalized email so a caller holding raw addresses can look each one
 * up without repeating the normalization.
 */
export function resolvePeople(
  emails: readonly string[],
  options: ResolveOptions = {},
): Record<string, Person> {
  if (emails.length === 0) return {};
  const enabled = options.enabled ?? isPeopleEnabled();
  let directory: Directory = {};
  if (enabled) {
    try {
      directory = options.directory ?? loadPeople();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[people] failed to load the directory for a batch: ${message}`);
    }
  }
  const resolved: Record<string, Person> = {};
  for (const email of emails) {
    const person = resolvePerson(email, { ...options, directory, enabled });
    resolved[person.email] = person;
  }
  return resolved;
}

/**
 * What the shell chrome calls the signed-in person.
 *
 * Flag ON the directory decides, and the name the identity provider sent is
 * ignored: it is already what seeded the directory row (see `sign-in.ts`), so
 * consulting it again only lets it outrank an admin's correction. That was the
 * bug: `X-Auth-Request-User` often carries an opaque user id, the header won
 * the tie, and the top-right chip showed the id no matter what the Members tab
 * said.
 *
 * Flag OFF this is exactly what the shell showed before the directory existed:
 * the header name, then the email local part, and no directory read.
 */
export function viewerName(
  email: string,
  headerName?: string,
  options: ResolveOptions = {},
): { name: string; initials: string } {
  if (options.enabled ?? isPeopleEnabled()) {
    const person = resolvePerson(email, { ...options, enabled: true });
    return { name: person.name, initials: person.initials };
  }
  const name = headerName?.trim() || email.split("@")[0];
  return { name, initials: name.charAt(0).toUpperCase() };
}

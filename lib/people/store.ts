import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { peopleFilePath } from "@/lib/authority/config";
import { PEOPLE_ACCESS_PATH } from "./config";
import type { Directory, PersonRecord, PersonSource } from "./types";
import { getConfig } from "@/lib/config";

export type { Directory, PersonRecord, PersonSource } from "./types";

const emailSchema = z.string().email();

const recordSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  source: z.enum(["idp", "manual"]).default("idp"),
});

// The rows are parsed one at a time rather than as one z.record(): a single
// row missing its name must cost that person their name, not cost everyone
// theirs. Same reasoning as loadFlagOverrides dropping unknown flag keys.
const fileSchema = z.object({ people: z.record(z.string(), z.unknown()) });

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads `access/people.yaml`. Never throws: a missing, unreadable, or malformed
 * file degrades to an empty directory, which makes every surface fall back to
 * the email. A presentation subsystem must not be able to take down a page.
 */
export function loadPeople(filePath?: string): Directory {
  // Resolved inside the try, not as a default argument: a default argument that
  // throws would escape this function's never-throws contract.
  let resolvedPath = filePath ?? "";
  let raw: string;
  try {
    resolvedPath = filePath ?? peopleFilePath();
    raw = readFileSync(resolvedPath, "utf8");
  } catch {
    // No directory file yet is the normal state of a fresh install, not an
    // error, and this runs on every render that names someone. Stay quiet.
    return {};
  }
  try {
    const parsed = fileSchema.parse(parse(raw));
    const directory: Directory = {};
    for (const [key, value] of Object.entries(parsed.people)) {
      const email = normalizedEmail(key);
      if (!emailSchema.safeParse(email).success) continue;
      const record = recordSchema.safeParse(value);
      if (!record.success) continue;
      directory[email] = record.data;
    }
    return directory;
  } catch (error) {
    console.error(`[people] failed to load people from ${resolvedPath}: ${message(error)}`);
    return {};
  }
}

export interface UpsertOptions {
  /** Who the commit is authored as. Defaults to the portal bot. */
  actorEmail?: string;
  /** Directory file to read the current state from. Defaults to the real one. */
  filePath?: string;
}

function serialize(directory: Directory): string {
  const sorted = Object.fromEntries(
    Object.entries(directory).sort(([a], [b]) => a.localeCompare(b)),
  );
  return stringify({ people: sorted });
}

function merged(existing: PersonRecord | undefined, name: string, title: string | undefined, source: PersonSource): PersonRecord {
  const resolvedTitle = title?.trim() || existing?.title;
  return { name, ...(resolvedTitle ? { title: resolvedTitle } : {}), source };
}

function unchanged(existing: PersonRecord | undefined, next: PersonRecord): boolean {
  return existing !== undefined
    && existing.name === next.name
    && existing.title === next.title
    && existing.source === next.source;
}

/**
 * Records one person's display name on the private access ref.
 *
 * Never throws and never reports failure to its caller: it sits behind
 * `resolveIdentity()`, which must not gain a failure mode because a name could
 * not be persisted. A refused or rejected commit is logged and dropped.
 *
 * Manual records are sticky: an `idp` upsert leaves a `manual` row alone, so an
 * admin's correction is not undone by the next sign-in.
 */
export async function upsertPerson(
  email: string,
  record: { name: string; title?: string; source: PersonSource },
  options: UpsertOptions = {},
): Promise<void> {
  // Inside the try: this function's contract is that it never throws, and
  // normalizing a non-string input throws before any of the guards below run.
  try {
    const key = normalizedEmail(email);
    if (!emailSchema.safeParse(key).success) return;
    const name = record.name.trim();
    if (!name) return;

    const directory = loadPeople(options.filePath);
    const existing = directory[key];
    if (existing?.source === "manual" && record.source === "idp") return;
    const next = merged(existing, name, record.title, record.source);
    if (unchanged(existing, next)) return;

    directory[key] = next;
    const actorEmail = normalizedEmail(options.actorEmail ?? getConfig().git.botEmail);
    // Imported at call time so the read side of this module stays free of the
    // git write path: `loadPeople()` runs on renders, `upsertPerson()` does not.
    const { commitPrivateAccess } = await import("@/lib/repo-write");
    const result = await commitPrivateAccess(
      { [PEOPLE_ACCESS_PATH]: serialize(directory) },
      {
        authorName: actorEmail,
        authorEmail: actorEmail,
        message: `chore(access): set display name for ${key}`,
      },
    );
    if (!result.ok) {
      console.error(`[people] directory write refused for ${key}: ${result.error}`);
    }
  } catch (error) {
    // `email` rather than the normalized key: normalizing is itself inside the
    // try, so the key may not exist when we get here.
    console.error(`[people] directory write failed for ${String(email)}: ${message(error)}`);
  }
}

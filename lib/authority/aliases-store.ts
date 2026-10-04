import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { invalidateAliasIndexCache } from "./aliases";
import { aliasesFilePath } from "./config";
import { allMembers, isKnownMember, loadGroups, type Groups } from "./groups";

/**
 * The mutate side of the identity alias registry (`access/aliases.yaml`).
 *
 * Deliberately not in `aliases.ts`: that module is on the render hot path with a
 * never-throws contract, and this one imports the git write path, which a module
 * every page render touches must not pull in.
 *
 * It also holds a different shape. `aliases.ts` exposes the REVERSE index
 * (alias -> canonical), which is what resolution needs and which cannot
 * round-trip a file: two canonicals with no aliases are indistinguishable from
 * none at all. Editing needs the forward map the file actually stores.
 */

/** canonical email -> the addresses that resolve to it. */
export type AliasMap = Record<string, string[]>;

const fileSchema = z.object({ aliases: z.record(z.string(), z.unknown()) });
const listSchema = z.array(z.string());
const emailSchema = z.string().email();

export function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

/**
 * Reads the forward alias map. Never throws, matching `loadAliasIndex`: a
 * missing file is the normal state of a fresh install, and a malformed one is
 * logged and degrades to an empty map.
 *
 * Rows are validated one at a time rather than as one `z.record()`, the same way
 * `loadPeople` does: one person's malformed list must cost that person their
 * aliases, not cost everyone theirs.
 */
export function loadAliasMap(filePath: string = aliasesFilePath()): AliasMap {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = fileSchema.parse(parse(raw));
    const map: AliasMap = {};
    for (const [key, value] of Object.entries(parsed.aliases)) {
      const canonical = normalizedEmail(key);
      if (!isEmail(canonical)) continue;
      const list = listSchema.safeParse(value);
      if (!list.success) continue;
      const aliases = [...new Set(list.data.map(normalizedEmail).filter(isEmail))].sort();
      if (aliases.length > 0) map[canonical] = aliases;
    }
    return map;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authority] failed to load the alias map from ${filePath}: ${message}`);
    return {};
  }
}

/**
 * The file text for a map: canonical keys sorted, each list sorted, and a
 * canonical whose list has gone empty dropped entirely rather than left behind
 * as a bare key with no aliases under it.
 */
export function serializeAliasMap(map: AliasMap): string {
  const rows = Object.entries(map)
    .filter(([, aliases]) => aliases.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([canonical, aliases]) => [canonical, [...aliases].sort((a, b) => a.localeCompare(b))]);
  return stringify({ aliases: Object.fromEntries(rows) });
}

export type AliasVerb = "addAlias" | "removeAlias";

export interface AliasChange {
  verb: AliasVerb;
  /** The canonical portal address the alias resolves to. */
  email: string;
  /** The other address that person appears under. */
  alias: string;
}

/**
 * Why a rejection happened, in the vocabulary the route maps to an error code.
 * `not_found` covers an unknown canonical, `taken` an address that already
 * belongs to someone, `self` the person's own canonical address, `invalid` a
 * malformed one, `unavailable` a refused commit.
 *
 * `taken` and `self` were one `conflict` reason, which the route mapped onto the
 * optimistic-concurrency error code. That told an admin a collision was a lost
 * race and to reload and retry, which never helps: nothing changed underneath
 * them and the next attempt is refused identically.
 */
export type AliasFailure = "not_found" | "taken" | "self" | "invalid" | "unavailable";

export type AliasWriteResult =
  | { ok: true; aliases: string[] }
  | { ok: false; reason: AliasFailure };

export interface AliasWriteOptions {
  filePath?: string;
  groups?: Groups;
}

/**
 * Everything an alias may not be, checked against the roster and the map.
 *
 * The collision rules are not politeness. `loadAliasIndex` already drops an
 * alias that collides with a canonical key, so an alias can never shadow a real
 * identity; accepting one here would write a line that silently does nothing and
 * leave an admin believing they had granted something. A member of a group is
 * refused for the same reason from the other direction: that address is already
 * its own identity with its own clearance, and folding it into someone else
 * would take its own memberships away from it.
 */
function rejection(map: AliasMap, canonical: string, alias: string, groups: Groups): AliasFailure | null {
  if (alias === canonical) return "self";
  if (map[alias]) return "taken";
  if (allMembers(groups).includes(alias)) return "taken";
  const owner = Object.entries(map).find(([, aliases]) => aliases.includes(alias));
  if (owner && owner[0] !== canonical) return "taken";
  return null;
}

/**
 * Applies one alias change and commits `access/aliases.yaml` to the private ref.
 *
 * Unlike the people directory's `upsertPerson`, this reports failure to its
 * caller. A display name is written behind identity resolution, which must not
 * gain a failure mode; an alias is written by an admin who pressed a button and
 * is owed the truth about whether it landed.
 */
export async function writeAlias(
  change: AliasChange,
  actorEmail: string,
  options: AliasWriteOptions = {},
): Promise<AliasWriteResult> {
  const canonical = normalizedEmail(change.email);
  const alias = normalizedEmail(change.alias);
  if (!isEmail(canonical) || !isEmail(alias)) return { ok: false, reason: "invalid" };

  const groups = options.groups ?? loadGroups();
  // The registry is a view over the roster, not a way to invent members. Same
  // rule the display-name route applies before it will name someone.
  if (!isKnownMember(canonical, groups)) return { ok: false, reason: "not_found" };

  const map = loadAliasMap(options.filePath);
  const current = map[canonical] ?? [];

  if (change.verb === "addAlias") {
    // Idempotent: a double submit is not an error, and reporting one would make
    // a retry after a slow commit look like a failure.
    if (current.includes(alias)) return { ok: true, aliases: current };
    const reason = rejection(map, canonical, alias, groups);
    if (reason) return { ok: false, reason };
    map[canonical] = [...current, alias].sort((a, b) => a.localeCompare(b));
  } else {
    if (!current.includes(alias)) return { ok: false, reason: "not_found" };
    const remaining = current.filter((entry) => entry !== alias);
    if (remaining.length > 0) map[canonical] = remaining;
    else delete map[canonical];
  }

  const { commitPrivateAccess } = await import("@/lib/repo-write");
  const committed = await commitPrivateAccess(
    { "access/aliases.yaml": serializeAliasMap(map) },
    {
      authorName: normalizedEmail(actorEmail),
      authorEmail: normalizedEmail(actorEmail),
      message: change.verb === "addAlias"
        ? `chore(access): add alias ${alias} for ${canonical}`
        : `chore(access): remove alias ${alias} from ${canonical}`,
    },
  );
  if (!committed.ok) {
    console.error(`[authority] alias write refused for ${canonical}: ${committed.error}`);
    return { ok: false, reason: "unavailable" };
  }
  // The cache in aliases.ts keys on the file's mtime and size, so a same-second
  // write of an equal-length file would keep serving the old index. writeAccess
  // drops the flag cache after its commit for exactly this reason.
  invalidateAliasIndexCache();
  return { ok: true, aliases: map[canonical] ?? [] };
}

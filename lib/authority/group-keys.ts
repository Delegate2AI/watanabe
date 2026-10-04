import { loadAccess } from "./access";
import { log } from "@/lib/log";

/**
 * Validation for a requested clearance list, shared by every admin surface that
 * writes group keys onto a registry entry.
 *
 * It lives here rather than beside one of them because the two subsystems that
 * use it are near-twins and drifted: skills refused a typo'd key while
 * connectors accepted any non-empty string, so `groups: ["enginering"]` wrote a
 * healthy-looking connector row that no grant resolver would ever match, with
 * no error anywhere. The deferred-grant shape is the worse half: a key that does
 * not exist YET silently starts granting the moment somebody creates a group
 * with that name, with no edit to the entry and no entry in its audit trail.
 */

/**
 * The one cap on a clearance list. `EntrySchema.groups` is unbounded on both
 * sides (a hand-edited file is the admin's own business), which makes this the
 * only thing between a request and a list that gets committed to the private
 * access ref, re-parsed on every write, and hashed into every materialization
 * key. Sized well above any real deployment's group count.
 */
export const MAX_CLEARANCE_GROUPS = 64;
export const MAX_GROUP_KEY_CHARS = 64;

/**
 * The universal clearance. It is implicit rather than declared, so it is absent
 * from `groups.yaml` and every caller carries it (`resolveClearance` always
 * prepends it).
 *
 * Named and accepted here because it is a real key that resolves: skills and
 * connectors both grant by plain intersection against the caller's clearance, so
 * an entry listing `all-hands` matches everyone, exactly as a KB note filed at
 * all-hands does. Rejecting it as "unknown" is what made those two subsystems
 * the only places in the app where a thing could not be offered to the whole
 * workspace, while notes and artifacts could.
 */
export const ALL_HANDS = "all-hands";

export type CheckedGroups = { ok: true; groups: string[] } | { ok: false };

/**
 * Bound, de-duplicate, and resolve a requested clearance list in one place.
 *
 * De-duplication is not cosmetic: without it a request can name the same key
 * thousands of times, and every copy is persisted, re-parsed, and hashed. The
 * result is sorted so the committed file is stable no matter what order a
 * client sent, which keeps a groups edit from producing a diff that only
 * reorders.
 */
export function checkGroups(raw: string[]): CheckedGroups {
  if (raw.length > MAX_CLEARANCE_GROUPS) return { ok: false };
  const seen = new Set<string>();
  for (const group of raw) {
    const value = group.trim();
    if (value === "" || value.length > MAX_GROUP_KEY_CHARS) return { ok: false };
    seen.add(value);
  }
  const groups = [...seen].sort();
  if (unknownGroups(groups).length > 0) return { ok: false };
  return { ok: true, groups };
}

/**
 * Group keys the request named that `access/groups.yaml` does not declare.
 *
 * Fails closed: if access cannot be read at all, every key is unknown, because
 * writing a clearance tag nothing can resolve would register something that
 * either nobody or (after a later typo fix) the wrong people can see. An empty
 * list is legitimate and means "nobody yet", which is how both the skills
 * materializer and the connector grant resolver read it.
 */
export function unknownGroups(groups: string[]): string[] {
  let known: Record<string, unknown>;
  try {
    known = loadAccess().groups;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    log.warn("admin could not read access groups", { err: text.replace(/\s+/g, " ").trim() });
    return [...groups].filter((group) => group !== ALL_HANDS);
  }
  return groups.filter((group) => group !== ALL_HANDS && !Object.hasOwn(known, group));
}

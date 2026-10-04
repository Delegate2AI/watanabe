import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { aliasIndex, canonicalEmail, type AliasIndex } from "./aliases";
import { groupsFilePath } from "./config";

const groupsSchema = z.object({
  groups: z.record(z.string(), z.array(z.string().email())),
});

export type Groups = Record<string, string[]>;

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function loadGroups(filePath: string = groupsFilePath()): Groups {
  try {
    const parsed = groupsSchema.parse(parse(readFileSync(filePath, "utf8")));
    return Object.fromEntries(
      Object.entries(parsed.groups).map(([group, members]) => [
        group,
        members.map(normalizedEmail),
      ]),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authority] failed to load groups from ${filePath}: ${message}`);
    return {};
  }
}

/**
 * A person's clearance: `all-hands` plus every group in `groups.yaml` they are
 * a member of.
 *
 * The requester is resolved through the alias registry FIRST. `groups.yaml`
 * lists canonical portal addresses, so a session authenticated under any other
 * address the same person owns previously matched no group at all and silently
 * collapsed to `["all-hands"]`. That is a quiet failure rather than a loud one:
 * the person keeps seeing every all-hands item, so the app looks like it works,
 * while everything scoped to a real group vanishes.
 *
 * Strictly widening, and only for people the registry already knows: an address
 * that is not an alias passes through `canonicalEmail` normalized and unchanged,
 * so this can never grant a group to someone who did not already have it.
 *
 * BOTH sides go through the registry, not just the requester. Canonicalizing one
 * side only meant an alias said two opposite things depending on which column it
 * landed in: as a requester it resolved to the person, but written into a group
 * it matched nobody, so that membership silently granted the group to no one.
 * An alias asserts that two addresses ARE one identity, which is not a claim
 * that can be true in one direction.
 */
export function resolveClearance(
  email: string,
  groups: Groups,
  aliases: AliasIndex = aliasIndex(),
): string[] {
  const requester = canonicalEmail(email, aliases);
  const memberships = Object.entries(groups)
    .filter(([, members]) => members.some((member) => canonicalEmail(member, aliases) === requester))
    .map(([group]) => group)
    .filter((group) => group !== "all-hands")
    .sort((a, b) => a.localeCompare(b));
  return ["all-hands", ...memberships];
}

export function isAdmin(email: string, groups: Groups, aliases: AliasIndex = aliasIndex()): boolean {
  const requester = canonicalEmail(email, aliases);
  return (groups.admins ?? []).some((member) => canonicalEmail(member, aliases) === requester);
}

/**
 * Whether this address belongs to someone on the roster.
 *
 * Alias-aware on both sides, so it agrees with `resolveClearance` and with the
 * `assignableMembers` list a picker offers. It has to: routes validate a posted
 * address with this, so a picker that offers a canonical address while
 * `groups.yaml` happens to list only that person's alias would otherwise be
 * offering an option that always fails on submit.
 */
export function isKnownMember(email: string, groups: Groups, aliases: AliasIndex = aliasIndex()): boolean {
  const candidate = canonicalEmail(email, aliases);
  return Object.values(groups).some((members) =>
    members.some((member) => canonicalEmail(member, aliases) === candidate));
}

/**
 * Every address `groups.yaml` lists, verbatim and deduped.
 *
 * Literally what the file says, which is what a collision check or a membership
 * validation needs. It is NOT one entry per person: someone listed under two
 * addresses appears twice. Use `assignableMembers` for anything a human picks
 * from.
 */
export function allMembers(groups: Groups): string[] {
  const seen = new Set<string>();
  for (const members of Object.values(groups)) {
    for (const member of members) seen.add(member.trim().toLowerCase());
  }
  return [...seen].sort();
}

/**
 * The roster a picker offers: one entry per PERSON, not per address.
 *
 * `groups.yaml` can list the same human twice, under a canonical address in one
 * group and under an address that `aliases.yaml` records as an alias of it in
 * another. Every consumer of `allMembers` then offered both, and since the two
 * rows usually resolve to the same display name they rendered as two identical
 * options with no way to tell them apart. Assigning to the alias row was also a
 * quiet mistake: `resolveClearance` canonicalizes first, so that row's own group
 * membership matches nobody.
 *
 * Folding is strictly narrowing, and never invents a member. An alias whose
 * canonical is NOT itself on the roster is left alone rather than folded onto an
 * address that is not in any group: `PATCH /api/tasks/[id]` validates the posted
 * assignee with `isKnownMember`, so folding there would offer an option that
 * always fails on submit.
 */
export function assignableMembers(
  groups: Groups,
  aliases: AliasIndex = aliasIndex(),
): string[] {
  const raw = allMembers(groups);
  const roster = new Set(raw);
  const seen = new Set<string>();
  for (const member of raw) {
    const canonical = canonicalEmail(member, aliases);
    seen.add(roster.has(canonical) ? canonical : member);
  }
  return [...seen].sort();
}

export function canSee(
  visibility: string[] | undefined,
  clearance: string[],
  admin: boolean,
): boolean {
  if (admin) return true;
  const required = visibility && visibility.length > 0 ? visibility : ["all-hands"];
  const allowed = new Set(clearance);
  return required.some((group) => allowed.has(group));
}

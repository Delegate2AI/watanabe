import { aliasIndex, canonicalEmail } from "@/lib/authority/aliases";
import { can } from "@/lib/authority/roles";
import { checkGroups } from "./admin-record";
import { authorGroups } from "./authors";
import { storeDirExists } from "./preflight";
import { loadSkillRegistry } from "./registry";
import type { SkillEntry, SkillSource } from "./types";

export type AuthoredEntry = SkillEntry & { source: Extract<SkillSource, { type: "authored" }> };

export type AuthoredEntryGate = { ok: true; entry: AuthoredEntry } | { ok: false; error: string };

export function isAdmin(email: string): boolean {
  return can(email, "manageAccess");
}

export function humanAuthor(email: string): string {
  return canonicalEmail(email.trim().toLowerCase(), aliasIndex());
}

export function boundedGroups(
  requested: string[],
  actorEmail: string,
  admin: boolean,
): { ok: true; groups: string[] } | { ok: false } {
  const checked = checkGroups(requested);
  if (!checked.ok || admin) return checked;
  const granted = new Set(authorGroups(actorEmail));
  return checked.groups.every((group) => granted.has(group)) ? checked : { ok: false };
}

function ownsEntry(actorEmail: string, recordedAuthor: string): boolean {
  const aliases = aliasIndex();
  return canonicalEmail(actorEmail, aliases) === canonicalEmail(recordedAuthor, aliases);
}

function currentGrantCovers(actorEmail: string, groups: string[]): boolean {
  const granted = authorGroups(actorEmail);
  if (granted.length === 0) return false;
  const held = new Set(granted);
  return groups.every((group) => held.has(group));
}

export function mayEditEntry(actorEmail: string, admin: boolean, entry: SkillEntry): boolean {
  if (admin) return true;
  if (entry.source.type !== "authored") return false;
  return ownsEntry(actorEmail, entry.source.author) && currentGrantCovers(actorEmail, entry.groups);
}

export function editableAuthoredEntry(
  actorEmail: string,
  slug: string,
  admin: boolean,
): AuthoredEntryGate {
  const entry = loadSkillRegistry().entries.find((candidate) => candidate.slug === slug);
  if (entry === undefined || entry.source.type !== "authored") {
    return { ok: false, error: "not an authored skill" };
  }
  if (!mayEditEntry(actorEmail, admin, entry)) return { ok: false, error: "forbidden" };
  return { ok: true, entry: entry as AuthoredEntry };
}

export function authoredEditGate(
  actorEmail: string,
  slug: string,
): { ok: true } | { ok: false; error: string } {
  try {
    const gate = editableAuthoredEntry(actorEmail, slug, isAdmin(actorEmail));
    return gate.ok ? { ok: true } : gate;
  } catch {
    return { ok: true };
  }
}

export type SlugConflict = { kind: "clear" } | { kind: "orphan" } | { kind: "taken"; error: string };

export function slugConflict(slug: string): SlugConflict {
  const registry = loadSkillRegistry();
  if (registry.errors.some((error) => error.slug === "*")) {
    return { kind: "taken", error: "skill registry is unreadable" };
  }
  if (registry.entries.some((entry) => entry.slug === slug)) {
    return { kind: "taken", error: "slug already taken" };
  }
  if (registry.errors.some((error) => error.slug === slug)) {
    return { kind: "taken", error: "slug already taken" };
  }
  if (storeDirExists(slug)) return { kind: "orphan" };
  return { kind: "clear" };
}

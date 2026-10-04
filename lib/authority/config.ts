import path from "node:path";
import { isFlagEnabled } from "@/lib/config/flags";
import { memoryWorktreeDir } from "@/lib/memory/config";

export function isAuthorityEnabled(): boolean {
  return isFlagEnabled("AUTHORITY_ENABLED");
}

/**
 * Alias administration feature flag (spec: admin alias editing, 2026-08-12).
 *
 * Names the admin surface, not aliases: alias RESOLUTION already ships and this
 * flag does not touch it. Off, `access/aliases.yaml` is hand-edited on the
 * private ref exactly as before, the members panel does not render, and the
 * route answers 404.
 *
 * The AUTHORITY_ENABLED half is a real dependency, not decoration: the registry's
 * `dependsOn` is presentation only, and an alias is meaningless while clearance
 * resolution is dormant.
 */
export function isAliasAdminEnabled(): boolean {
  return isAuthorityEnabled() && isFlagEnabled("ALIASES_ADMIN_ENABLED");
}

export function groupsFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "groups.yaml");
}

/**
 * Where the identity alias registry lives: beside groups.yaml on the private
 * portal-memory ref. Clearance-domain data, deliberately separate from the
 * presentation-only people.yaml (see lib/authority/aliases.ts).
 */
export function aliasesFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "aliases.yaml");
}

/**
 * Where the people directory lives: beside groups.yaml and roles.yaml on the
 * private portal-memory ref. Deliberately a separate file, so a malformed
 * directory can never take clearance resolution down with it.
 */
export function peopleFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "people.yaml");
}

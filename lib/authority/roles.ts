import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { isFlagEnabled } from "@/lib/config/flags";
import { memoryWorktreeDir } from "@/lib/memory/config";
import { aliasIndex, canonicalEmail, type AliasIndex } from "./aliases";
import { getConfig } from "@/lib/config";

export const ROLE_NAMES = ["viewer", "editor", "approver", "admin"] as const;
export type Role = (typeof ROLE_NAMES)[number];
export type Roles = Partial<Record<Role, string[]>>;
export type Capability = "write" | "approve" | "manageAccess" | "triggerIngest";
export const DEFAULT_ROLE_NAMES = ["viewer", "editor"] as const;
export type DefaultRole = (typeof DEFAULT_ROLE_NAMES)[number];

interface RolesFile {
  roles: Roles;
  defaultRole: DefaultRole;
}

const EMPTY_ROLES_FILE: RolesFile = { roles: {}, defaultRole: "viewer" };

const roleMembersSchema = z.array(z.string().email());
const rolesSchema = z.object({
  roles: z
    .object({
      viewer: roleMembersSchema.optional(),
      editor: roleMembersSchema.optional(),
      approver: roleMembersSchema.optional(),
      admin: roleMembersSchema.optional(),
    })
    .strict(),
  default: z.enum(DEFAULT_ROLE_NAMES),
});

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether this address holds admin through `BOOTSTRAP_ADMINS` rather than
 * through `roles.yaml`.
 *
 * Exported so a surface can EXPLAIN itself: Access administration shows the
 * viewer's effective role beside a member list that reads from the roles store,
 * and a bootstrap admin appears in the first and not the second. Both were
 * correct and, side by side with nothing to reconcile them, read as a bug.
 */
export function isBootstrapAdmin(email: string): boolean {
  const requester = normalizedEmail(email);
  return (process.env.BOOTSTRAP_ADMINS ?? "")
    .split(",")
    .map(normalizedEmail)
    .filter((candidate) => roleMembersSchema.element.safeParse(candidate).success)
    .includes(requester);
}

// Must match BOT_COMMITTER_EMAIL in lib/repo-write.ts. Only the full committer
// address grants the implicit admin role; the bare "portal-bot" string is not a
// resolvable IdP identity, so accepting it would only widen the admin surface.
export function isPortalBot(email: string): boolean {
  return normalizedEmail(email) === normalizedEmail(getConfig().git.botEmail);
}

function rolesFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "roles.yaml");
}

export function isRolesEnabled(): boolean {
  return isFlagEnabled("ROLES_ENABLED");
}

function readRoles(filePath: string): RolesFile {
  try {
    const parsed = rolesSchema.parse(parse(readFileSync(filePath, "utf8")));
    return {
      roles: Object.fromEntries(
        Object.entries(parsed.roles).map(([role, members]) => [
          role,
          members.map(normalizedEmail),
        ]),
      ),
      defaultRole: parsed.default,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authority] failed to load roles from ${filePath}: ${message}`);
    return EMPTY_ROLES_FILE;
  }
}

type RolesCacheEntry = { path: string; mtimeMs: number; size: number; value: RolesFile };
let rolesCache: RolesCacheEntry | null = null;

/** Drops the cached roles; call after a committed `access/roles.yaml` change. */
export function invalidateRolesCache(): void {
  rolesCache = null;
}

/**
 * The roles map, cached against the file's identity (path, mtime, size) rather
 * than held for the life of the process, exactly as `aliasIndex` and
 * `cachedFlagOverrides` are and for the same reason: the worktree is a git
 * checkout, so something other than this process can move the file underneath
 * us.
 *
 * The cache is what makes a capability check affordable. `can()` defaults its
 * `roles` argument to this function, so before the cache every check was a file
 * read, a YAML parse and a zod validation: `PATCH /api/tasks/[id]` does two per
 * request, every page render does at least one, and every MCP tool call will do
 * one more.
 *
 * Never throws, because `readRoles` never throws. A missing file caches nothing
 * and returns an empty map, which leaves `effectiveRole` at its viewer default,
 * so a deployment that has never written `roles.yaml` behaves exactly as it did
 * before. That case is silent now rather than logging per call: an absent file
 * is the normal state for such a deployment, and the log said so on every
 * capability check. A file that exists and does not parse still logs, which is
 * the case that actually wants an operator's attention.
 */
function loadRolesFile(filePath: string): RolesFile {
  let mtimeMs: number;
  let size: number;
  try {
    const stamp = statSync(filePath);
    mtimeMs = stamp.mtimeMs;
    size = stamp.size;
  } catch {
    rolesCache = null;
    return EMPTY_ROLES_FILE;
  }
  if (rolesCache && rolesCache.path === filePath && rolesCache.mtimeMs === mtimeMs && rolesCache.size === size) {
    return rolesCache.value;
  }
  const value = readRoles(filePath);
  rolesCache = { path: filePath, mtimeMs, size, value };
  return value;
}

export function loadRoles(filePath: string = rolesFilePath()): Roles {
  return loadRolesFile(filePath).roles;
}

export function loadDefaultRole(filePath: string = rolesFilePath()): DefaultRole {
  return loadRolesFile(filePath).defaultRole;
}

/**
 * The role an address holds: the highest one `roles.yaml` grants it, or the file's default.
 *
 * Alias-aware, exactly as `resolveClearance` is. It was not, and the two halves
 * of authority then disagreed about who someone is: a session signed in under an
 * alias resolved to the person for CLEARANCE and to a stranger for ROLE, so it
 * carried its colleague's groups while dropping to viewer. That is invisible
 * from the inside, since a viewer sees content and only loses the write and
 * admin controls, which simply do not render.
 *
 * The registry's whole claim is that two addresses are one identity. Honouring
 * that for groups and not for capabilities makes the claim mean different things
 * in the two files it has to hold across.
 */
export function effectiveRole(
  email: string,
  roles: Roles = loadRoles(),
  aliases: AliasIndex = aliasIndex(),
  fallback: DefaultRole = loadDefaultRole(),
): Role {
  if (isPortalBot(email) || isBootstrapAdmin(email)) return "admin";
  const requester = canonicalEmail(email, aliases);
  for (const role of ["admin", "approver", "editor", "viewer"] as const) {
    if ((roles[role] ?? []).some((member) => canonicalEmail(member, aliases) === requester)) {
      return role;
    }
  }
  return fallback;
}

const CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set(),
  editor: new Set(["write"]),
  approver: new Set(["write", "approve"]),
  admin: new Set(["write", "approve", "manageAccess", "triggerIngest"]),
};

export function can(email: string, capability: Capability, roles?: Roles, fallback?: DefaultRole): boolean {
  if (isPortalBot(email) || isBootstrapAdmin(email)) {
    return CAPABILITIES.admin.has(capability);
  }
  if (!isRolesEnabled()) {
    return capability === "write" || capability === "approve";
  }
  return CAPABILITIES[effectiveRole(email, roles, undefined, fallback)].has(capability);
}

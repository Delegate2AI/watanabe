import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { FLAG_NAMES } from "@/lib/config/flag-registry";
import { invalidateFlagOverridesCache, loadFlagOverrides } from "@/lib/config/flags";
import { memoryWorktreeDir } from "@/lib/memory/config";
import { commitPrivateAccess } from "@/lib/repo-write";
import { run, unfilteredVaultRoot } from "@/lib/repo";
import { isAuthorityEnabled } from "./config";
import { loadGroups, type Groups } from "./groups";
import {
  can,
  invalidateRolesCache,
  isRolesEnabled,
  loadDefaultRole,
  loadRoles,
  ROLE_NAMES,
  type DefaultRole,
  type Role,
  type Roles,
} from "./roles";

export interface AccessState {
  groups: Groups;
  roles: Roles;
  flags: Partial<Record<string, boolean>>;
  default: DefaultRole;
}

export type AccessChange =
  | { verb: "addToGroup" | "removeFromGroup"; group: string; email: string }
  | { verb: "createGroup" | "deleteGroup"; group: string }
  | { verb: "setRole"; email: string; role: Role }
  | { verb: "setFlag"; name: string; value: boolean };

export interface AccessWriteResult {
  ok: boolean;
  error?: string;
  version?: string;
  warnings?: string[];
}

export interface AccessHistoryEntry {
  sha: string;
  author: string;
  email: string;
  at: string;
  summary: string;
}

interface WriteOptions {
  root?: string;
  vaultRoot?: string;
}

const emailSchema = z.string().email();

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function loadAccess(root: string = memoryWorktreeDir()): AccessState {
  const accessDir = path.join(root, "access");
  const rolesPath = path.join(accessDir, "roles.yaml");
  return {
    groups: loadGroups(path.join(accessDir, "groups.yaml")),
    roles: loadRoles(rolesPath),
    flags: loadFlagOverrides(path.join(accessDir, "flags.yaml")),
    default: loadDefaultRole(rolesPath),
  };
}

export async function loadAccessHistory(root: string = memoryWorktreeDir()): Promise<AccessHistoryEntry[]> {
  try {
    const output = await run("git", [
      "-C", root, "log", "-n", "30", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s",
      // aliases.yaml is here and people.yaml is not: an alias decides which
      // groups a session resolves to, so it belongs in the same audit trail as
      // the group and role changes it can stand in for. A display name does not.
      "--", "access/groups.yaml", "access/roles.yaml", "access/flags.yaml", "access/aliases.yaml",
    ]);
    return output.split("\n").filter(Boolean).map((line) => {
      const [sha, author, email, at, summary] = line.split("\x1f");
      return { sha, author, email, at, summary };
    });
  } catch {
    return [];
  }
}

function applyChange(state: AccessState, change: AccessChange): AccessState {
  const groups = Object.fromEntries(
    Object.entries(state.groups).map(([group, members]) => [group, [...members]]),
  );
  const roles = Object.fromEntries(
    Object.entries(state.roles).map(([role, members]) => [role, [...members]]),
  ) as Roles;
  const flags = { ...state.flags };
  const group = "group" in change ? change.group.trim() : "";

  if (change.verb === "addToGroup") {
    groups[group] = [...new Set([...(groups[group] ?? []), normalizedEmail(change.email)])].sort();
  } else if (change.verb === "removeFromGroup") {
    groups[group] = (groups[group] ?? []).filter((email) => email !== normalizedEmail(change.email));
  } else if (change.verb === "createGroup") {
    groups[group] ??= [];
  } else if (change.verb === "deleteGroup") {
    delete groups[group];
  } else if (change.verb === "setRole") {
    const email = normalizedEmail(change.email);
    for (const role of ROLE_NAMES) roles[role] = (roles[role] ?? []).filter((member) => member !== email);
    roles[change.role] = [...new Set([...(roles[change.role] ?? []), email])].sort();
  } else if (change.verb === "setFlag") {
    flags[change.name] = change.value;
  }
  const populatedRoles = Object.fromEntries(
    Object.entries(roles).filter(([, members]) => members && members.length > 0),
  ) as Roles;
  return { groups, roles: populatedRoles, flags, default: state.default };
}

/**
 * The commit subject for an accepted change.
 *
 * It names the thing that moved and the value it moved to, because the history
 * tab renders nothing but this line. `chore(access): setFlag` repeated seven
 * times told a reader which verb ran and nothing else: not which flag, not what
 * it became. Entries committed before this existed keep their old subject; the
 * history is not rewritten.
 */
function commitSubject(change: AccessChange): string {
  const group = "group" in change ? change.group.trim() : "";
  const email = "email" in change ? normalizedEmail(change.email) : "";
  if (change.verb === "setFlag") {
    return `chore(access): set flag ${change.name}=${change.value ? "on" : "off"}`;
  }
  if (change.verb === "setRole") return `chore(access): set role for ${email} to ${change.role}`;
  if (change.verb === "addToGroup") return `chore(access): add ${email} to ${group}`;
  if (change.verb === "removeFromGroup") return `chore(access): remove ${email} from ${group}`;
  if (change.verb === "createGroup") return `chore(access): create group ${group}`;
  return `chore(access): delete group ${group}`;
}

function accessYaml(state: AccessState): { groups: string; roles: string; flags: string } {
  const roles = Object.fromEntries(
    ROLE_NAMES.flatMap((role) => state.roles[role]?.length ? [[role, state.roles[role]]] : []),
  );
  return {
    groups: stringify({ groups: state.groups }),
    roles: stringify({ roles, default: state.default }),
    flags: stringify({ flags: state.flags }),
  };
}

function validBootstrapAdmins(): string[] {
  return (process.env.BOOTSTRAP_ADMINS ?? "")
    .split(",")
    .map(normalizedEmail)
    .filter((email) => emailSchema.safeParse(email).success);
}

function reparses(
  state: AccessState,
  yaml: { groups: string; roles: string; flags: string },
): boolean {
  const root = mkdtempSync(path.join(os.tmpdir(), "access-validate-"));
  try {
    const accessDir = path.join(root, "access");
    mkdirSync(accessDir);
    writeFileSync(path.join(accessDir, "groups.yaml"), yaml.groups);
    writeFileSync(path.join(accessDir, "roles.yaml"), yaml.roles);
    writeFileSync(path.join(accessDir, "flags.yaml"), yaml.flags);
    return isDeepStrictEqual(loadAccess(root), state);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function markdownFiles(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      return entry.isDirectory() ? markdownFiles(absolute) : entry.name.endsWith(".md") ? [absolute] : [];
    });
  } catch {
    return [];
  }
}

function groupReferenceCount(root: string, group: string): number {
  return markdownFiles(root).filter((file) => {
    const content = readFileSync(file, "utf8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return false;
    try {
      const visibility = (parse(match[1]) as { visibility?: unknown }).visibility;
      return Array.isArray(visibility) && visibility.includes(group);
    } catch {
      return false;
    }
  }).length;
}

export async function writeAccess(
  change: AccessChange,
  actorEmail: string,
  options: WriteOptions = {},
): Promise<AccessWriteResult> {
  const root = options.root ?? memoryWorktreeDir();
  const rolesPath = path.join(root, "access", "roles.yaml");
  if (!can(actorEmail, "manageAccess", loadRoles(rolesPath), loadDefaultRole(rolesPath))) {
    return { ok: false, error: "forbidden" };
  }
  // setFlag deliberately has no isAuthorityEnabled()/isRolesEnabled() gate of
  // its own, unlike setRole and the group verbs below: those flags are two of
  // the things setFlag exists to turn on in the first place, so requiring
  // either to already be on would make it impossible to ever bootstrap them
  // from off. The manageAccess capability check above is the real gate
  // (bootstrap admin, or an admin role when ROLES_ENABLED is already on),
  // same as every other verb here.
  if (change.verb === "setFlag" && !FLAG_NAMES.has(change.name)) {
    return { ok: false, error: "unknown flag" };
  }
  if (change.verb === "setRole" && !isRolesEnabled()) {
    return { ok: false, error: "feature disabled" };
  }
  if ("group" in change && !isAuthorityEnabled()) {
    return { ok: false, error: "feature disabled" };
  }
  if ("group" in change && change.group.trim() === "") return { ok: false, error: "group is required" };
  if ("email" in change && !emailSchema.safeParse(normalizedEmail(change.email)).success) {
    return { ok: false, error: "valid email is required" };
  }

  const next = applyChange(loadAccess(root), change);
  if ((next.roles.admin ?? []).length === 0 && validBootstrapAdmins().length === 0) {
    return { ok: false, error: "at least one admin is required" };
  }
  const yaml = accessYaml(next);
  if (!reparses(next, yaml)) return { ok: false, error: "access configuration failed validation" };

  const warnings: string[] = [];
  if (change.verb === "deleteGroup") {
    const count = groupReferenceCount(options.vaultRoot ?? unfilteredVaultRoot(), change.group.trim());
    if (count > 0) warnings.push(`Group ${change.group.trim()} is referenced by ${count} ${count === 1 ? "note" : "notes"}.`);
  }
  const files = {
    "access/groups.yaml": yaml.groups,
    "access/roles.yaml": yaml.roles,
    "access/flags.yaml": yaml.flags,
  };
  const committed = await commitPrivateAccess(files, {
    authorName: normalizedEmail(actorEmail),
    authorEmail: normalizedEmail(actorEmail),
    message: commitSubject(change),
  });
  if (!committed.ok) return { ok: false, error: committed.error ?? "access commit failed" };
  if (change.verb === "setFlag") invalidateFlagOverridesCache();
  // Unconditional, unlike the flag line above: every verb rewrites all three
  // files, so roles.yaml has just moved whatever the change was. The stamp
  // cache would usually notice on its own, but this process's own write can
  // land inside the same mtime tick at the same size, and a stale capability
  // map is the one thing a caller must never read back after changing it.
  invalidateRolesCache();
  const version = createHash("sha256")
    .update(yaml.groups)
    .update("\0")
    .update(yaml.roles)
    .update("\0")
    .update(yaml.flags)
    .digest("hex");
  return { ok: true, version, warnings };
}

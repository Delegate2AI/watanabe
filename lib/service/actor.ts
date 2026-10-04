import type { Database as DatabaseType } from "better-sqlite3";
import { loadGroups, resolveClearance, type Groups } from "@/lib/authority/groups";
import { can, type Capability } from "@/lib/authority/roles";

/**
 * Who is asking, resolved once, in a form no surface can forge.
 *
 * A service function never receives a `Request`. A route builds an actor from
 * `requireIdentity`, the MCP transport builds one from its already-resolved
 * caller, and both go through this same resolver over an address their own
 * boundary has already authenticated. That is what lets one implementation of
 * an access rule serve both surfaces: there is no path by which one of them can
 * construct an actor the other could not.
 */
export interface Actor {
  /** Trimmed and lowercased. Services compare against this, never a raw header value. */
  readonly email: string;
  readonly clearance: string[];
  /**
   * The roster this actor was resolved against, carried so one request reads
   * `groups.yaml` once. A caller typically needs it twice, to resolve this
   * person's clearance and then to check that an address they named is somebody,
   * and `loadGroups` is an uncached read that could see a different file the
   * second time.
   */
  readonly groups: Groups;
  can(capability: Capability): boolean;
}

export interface ServiceContext {
  db: DatabaseType;
  actor: Actor;
}

/**
 * `can` is a two-argument delegate, never three. Passing a cached `Roles` would
 * mean importing `loadRoles` into the transitive graph of routes whose tests
 * replace `@/lib/authority/roles` wholesale with a two-export factory, where any
 * further import is `undefined` at runtime. The per-call cost that would have
 * bought is instead fixed at the source, inside `loadRoles` itself, which helps
 * every existing caller rather than only this one.
 */
function build(email: string, groups: Groups | undefined, floor: Capability | null): Actor {
  const normalized = email.trim().toLowerCase();
  const roster = groups ?? loadGroups();
  const clearance = resolveClearance(normalized, roster);
  return {
    email: normalized,
    clearance,
    groups: roster,
    can: (capability: Capability) => can(normalized, capability) || capability === floor,
  };
}

/** The actor a route builds: exactly the capabilities the person holds. */
export function actorFor(email: string, groups?: Groups): Actor {
  return build(email, groups, null);
}

/**
 * The actor the MCP surface builds: the same person, floored at editor.
 *
 * Stage and prod both run with `ROLES_ENABLED` on, and `effectiveRole` puts
 * anyone absent from `roles.yaml` at viewer, which holds no capability at all.
 * Without a floor the workspace tools would register for almost nobody and the
 * surface would be read-only for the staff it exists to serve.
 *
 * The floor is exactly `write`, which is the editor role and nothing above it:
 * `approve`, `manageAccess` and `triggerIngest` still require a real role. The
 * knowledge-base write path does not use this floor either. It checks the real
 * `can` at registration, and `kb_submit` checks it again itself, so a merge
 * request into the vault still needs a role a person was actually given.
 */
export function mcpActorFor(email: string, groups?: Groups): Actor {
  return build(email, groups, "write");
}

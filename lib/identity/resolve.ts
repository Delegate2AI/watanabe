import { getIdentity } from "@/lib/auth/identity";
import type { HeaderSource } from "@/lib/auth/types";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { effectiveRole, isRolesEnabled, type Role } from "@/lib/authority/roles";
import { notePersonName } from "@/lib/people/sign-in";

export interface ResolvedIdentity {
  email: string;
  name?: string;
  clearance: string[];
  role?: Role;
}

export function resolveClearanceForEmail(email: string): string[] {
  if (!isAuthorityEnabled()) return ["all-hands"];
  return resolveClearance(email, loadGroups());
}

export async function resolveIdentity(headers: HeaderSource): Promise<ResolvedIdentity | null> {
  const identity = await getIdentity(headers);
  if (!identity) return null;
  // Fire and forget: the people directory self-populates from the name the IdP
  // already sends. notePersonName never throws and is never awaited, so a
  // directory write cannot make identity resolution fail or wait.
  notePersonName(identity.email, identity.name);
  return {
    ...identity,
    clearance: resolveClearanceForEmail(identity.email),
    ...(isRolesEnabled() ? { role: effectiveRole(identity.email) } : {}),
  };
}

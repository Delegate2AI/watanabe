import type { Database as DatabaseType } from "better-sqlite3";
import { requireIdentity } from "@/lib/auth/identity";
import { fail } from "@/lib/errors/codes";
import type { Identity } from "@/lib/auth/types";
import { accessFor, type EffectiveAccess } from "./access";
import { shareClearanceFor } from "./clearance";
import { isSharedDocsEnabled } from "./config";

/**
 * Shared route front-door for the authenticated shared-docs API (spec 28).
 * Resolves identity (401 if none) and, when the feature is off, returns the
 * same 404 every doc route uses so flag-off is a dark surface. On success it
 * hands back the identity plus the caller's effective access on `docId`,
 * resolved through the one ACL seam (`accessFor`). Routes then gate on the
 * capability helpers and map "none" to 404 (no existence oracle).
 */
export async function authorizeDoc(
  request: Request,
  db: DatabaseType,
  docId: string,
): Promise<{ identity: Identity; access: EffectiveAccess } | { response: Response }> {
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate;
  const { email } = gate.identity;
  return { identity: gate.identity, access: accessFor(db, docId, email, shareClearanceFor(email)) };
}

/**
 * The pre-body half of the front-door: resolve identity (401 if none) and gate
 * on the feature flag (404 if off), WITHOUT resolving the ACL yet. Mutating
 * routes use this so they can parse the request body (an async step) and THEN
 * re-resolve the ACL synchronously immediately before the write, closing the
 * TOCTOU window where access could be revoked/downgraded mid-request. Reads use
 * {@link authorizeDoc}, which resolves the ACL in one shot.
 */
export async function requireEnabledIdentity(
  request: Request,
): Promise<{ identity: Identity } | { response: Response }> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth;
  if (!isSharedDocsEnabled()) return { response: notFound() };
  return { identity: auth.identity };
}

/** The single 404 shape every shared-doc route returns for deny/unknown/flag-off. */
export function notFound(): Response {
  return fail("not_found");
}

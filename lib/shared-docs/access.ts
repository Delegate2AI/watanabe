import type { Database as DatabaseType } from "better-sqlite3";
import { getSharedDoc, sharesForPrincipal, getLink } from "@/lib/db/shared-docs";
import type { LinkAccess } from "./types";

/**
 * The single authorization seam for shared docs (spec 28). Every read/list/
 * comment/edit/share/revoke route resolves the requester's effective access
 * HERE, server-side, and denies with a 404 (never confirming existence) when it
 * is "none". The ACL is explicit: owner OR a `doc_shares` row OR a valid
 * `doc_links` token.
 *
 * TEAM SHARING (migration v26) narrows an older rule rather than dropping it.
 * This module used to refuse the caller's group clearance outright. It now
 * accepts it as the thing that RESOLVES a group grant, and the invariant that
 * mattered is unchanged and still enforced here:
 *
 *   Clearance alone never grants access.
 *
 * A reader gets in only when the owner wrote an explicit `doc_shares` row naming
 * their team, exactly as an explicit row naming their address would. Membership
 * decides who that row currently covers; it never conjures a row. So the two
 * directions the old comment was protecting both still hold: sharing a doc never
 * widens KB clearance, and being cleared for a group never reaches a document
 * nobody shared with that group.
 */

/** Effective access, from lowest to highest privilege. */
export type EffectiveAccess = "none" | "view" | "comment" | "edit" | "owner";

const RANK: Record<EffectiveAccess, number> = { none: 0, view: 1, comment: 2, edit: 3, owner: 4 };

/**
 * The requester's effective access on `docId`: the HIGHEST of owner, their own
 * share row, and any team share row for a group in `groups`. The owner has full
 * control; a named recipient has exactly their granted level; everyone else, and
 * an unknown doc, resolve identically to "none" (no oracle). Token access is
 * per-token, not per-email, so it is resolved by {@link accessForToken}, never
 * folded in here.
 *
 * `groups` is the caller's resolved clearance and defaults to `[]`, which is the
 * pre-team behaviour exactly: user rows only. Callers that have not resolved
 * clearance therefore fail CLOSED (they under-grant, never over-grant), and the
 * feature flag switches off by passing `[]` through this same door.
 *
 * Highest-wins matters here because the two grants genuinely overlap: someone
 * can hold "view" through the engineering team and "edit" as a named individual,
 * and the specific grant must not be silently capped by the broad one.
 */
export function accessFor(
  db: DatabaseType,
  docId: string,
  email: string,
  groups: string[] = [],
): EffectiveAccess {
  const doc = getSharedDoc(db, docId);
  if (!doc) return "none";
  if (doc.ownerEmail === email) return "owner";
  let best: EffectiveAccess = "none";
  for (const access of sharesForPrincipal(db, docId, email, groups)) {
    if (RANK[access] > RANK[best]) best = access;
  }
  return best;
}

/**
 * Validate an external signed-link token: it must exist, its doc must still
 * exist, and it must be unexpired at `now`. Returns the doc id and the link's
 * capability (view|comment, never edit), or `null` for an unknown, revoked, or
 * expired token: all three are indistinguishable (no oracle, no id/owner leak).
 */
export function accessForToken(
  db: DatabaseType,
  token: string,
  now: string = new Date().toISOString(),
): { docId: string; access: LinkAccess } | null {
  const link = getLink(db, token);
  if (!link) return null;
  if (link.expiresAt !== null && link.expiresAt <= now) return null;
  if (!getSharedDoc(db, link.docId)) return null;
  return { docId: link.docId, access: link.access };
}

/** Read the current version: any access above "none". */
export function canRead(access: EffectiveAccess): boolean {
  return RANK[access] >= RANK.view;
}

/** Add a comment: comment access or higher. A view-only principal cannot. */
export function canComment(access: EffectiveAccess): boolean {
  return RANK[access] >= RANK.comment;
}

/** Append a new version: edit access or higher. A comment principal cannot. */
export function canEdit(access: EffectiveAccess): boolean {
  return RANK[access] >= RANK.edit;
}

/** Manage shares/links and delete: the owner only. */
export function canManage(access: EffectiveAccess): boolean {
  return access === "owner";
}

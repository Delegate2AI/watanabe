import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { resolveIdentity } from "@/lib/identity/resolve";
import { unfilteredVaultRoot, vaultRootFor } from "@/lib/repo";
import { can } from "@/lib/authority/roles";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Resolve the requester's clearance-scoped vault root for a server component
 * (spec 25). This is the single security seam for the KB view: every read
 * (tree, doc, backlinks, search) goes through the returned `root`, which is
 * `vaultRootFor(clearance)` (spec 19). A restricted note is physically absent
 * from that root, so it is absent from every surface.
 *
 * Fails closed on an unauthenticated request. A null identity means no KB
 * access at all, so it maps to `notFound()` rather than a clearance. This is
 * deliberately distinct from the authority-off case: there a KNOWN identity
 * resolves to `["all-hands"]` and `vaultRootFor` returns the single full vault
 * (spec 25's documented pre-authority fallback, where every authenticated user
 * reads the whole vault). Granting all-hands to a MISSING identity would let an
 * unauthenticated caller read the vault, so the two cases are kept separate.
 * This mirrors the `requireIdentity` contract used by the API routes; for local
 * dev, set `DEV_IDENTITY_EMAIL` (or send `X-Dev-Identity-Email` when
 * `PORTAL_ALLOW_DEV_IDENTITY_HEADER=1`).
 */
export async function requesterVaultRoot(): Promise<{ clearance: string[]; root: string }> {
  const identity = await resolveIdentity(await headers());
  if (!identity) {
    notFound();
  }
  return { clearance: identity.clearance, root: vaultRootFor(identity.clearance) };
}

export interface KbRoots {
  treeRoot: string;
  readRoot: string;
  isAdmin: boolean;
  manage: boolean;
}

/**
 * Pick the tree root and the read root. The READ root is ALWAYS the requester's
 * clearance-scoped projection: manage mode never widens what body content is
 * served. Only the TREE (the list of names/paths) switches to the unfiltered
 * vault, and only for an admin with the flag on.
 */
export function selectKbRoots(opts: { clearance: string[]; email: string; manageRequested: boolean }): KbRoots {
  const readRoot = vaultRootFor(opts.clearance);
  // "Admin AND the access-admin feature is enabled." Its only consumer is the
  // manage toggle: with the flag off, no admin sees the toggle, so the
  // flag-off byte-path stays identical for every requester, admin or not.
  const isAdmin = isFlagEnabled("KB_ACCESS_UI_ENABLED") && can(opts.email, "manageAccess");
  const manage = opts.manageRequested && isAdmin;
  return { treeRoot: manage ? unfilteredVaultRoot() : readRoot, readRoot, isAdmin, manage };
}

export async function requesterKbRoots(
  manageRequested: boolean,
): Promise<{ clearance: string[]; email: string } & KbRoots> {
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  const roots = selectKbRoots({ clearance: identity.clearance, email: identity.email, manageRequested });
  return { clearance: identity.clearance, email: identity.email, ...roots };
}

import { z } from "zod";
import { reconcileInReviewArtifacts } from "@/lib/artifacts/reconcile";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { requireIdentity, type Identity } from "@/lib/auth/identity";
import { aliasIndex, canonicalEmail } from "@/lib/authority/aliases";
import { can } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { recordDecision } from "@/lib/db/review-decisions";
import { fail } from "@/lib/errors/codes";
import { getGitHost, type MergeOutcome } from "@/lib/git-host";
import { rebuildIndex } from "@/lib/index/cache";
import { isIndexEnabled } from "@/lib/index/config";
import { clearKbGraphCache } from "@/lib/kb/graph-cache";
import { log } from "@/lib/log";
import { refreshRepo } from "@/lib/repo";
import { isKbReviewEnabled } from "@/lib/review/config";
import { loadProposal, type Proposal } from "@/lib/review/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ action: z.enum(["approve", "reject"]) }).strict();

/**
 * A proposer is an email where a publish row named one, and a display name where
 * the proposal came from chat. Emails compare alias-aware; a name can only be
 * compared against the identity's own name, and no name means not-self.
 */
function isSelfApproval(identity: Identity, proposal: Proposal): boolean {
  const proposer = proposal.proposer.trim();
  if (!proposer) return false;
  if (proposer.includes("@")) {
    const aliases = aliasIndex();
    return canonicalEmail(proposer, aliases) === canonicalEmail(identity.email, aliases);
  }
  const name = identity.name?.trim();
  return name !== undefined && name.length > 0 && name.toLowerCase() === proposer.toLowerCase();
}

/**
 * Approve or reject one knowledge-base proposal. Every gate is re-derived here:
 * the flag, the `approve` capability, and the proposal's own clearance through
 * `loadProposal`. Nothing the client sends is trusted beyond the iid and the
 * action, because this is the one surface that can merge into the vault.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ iid: string }> },
): Promise<Response> {
  if (!isKbReviewEnabled()) return fail("not_found");
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;
  if (!can(identity.email, "approve")) return fail("needs_role");

  const iid = Number((await params).iid);
  if (!Number.isInteger(iid) || iid <= 0) return fail("invalid_request", { detail: "iid" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "action" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "action" });

  const token = process.env.REPO_WRITE_TOKEN?.trim();
  if (!token) return fail("write_unavailable");

  // Clearance is read off the local checkout, so bring it current before
  // authorizing: a note tightened on `main` since the last refresh would
  // otherwise be judged against its old visibility. Never throws, by contract.
  await refreshRepo();

  let proposal: Proposal | null;
  try {
    proposal = await loadProposal(getDb(), identity.email, iid);
  } catch (error) {
    log.warn("review: could not load the proposal", { iid, err: String(error) });
    return fail("review_unavailable");
  }
  // Not cleared and not found are one answer: the queue is not an oracle for the
  // existence of proposals against notes you cannot see.
  if (!proposal) return fail("not_cleared");

  if (parsed.data.action === "reject") {
    try {
      await getGitHost().closeChangeRequest({ iid, token });
    } catch (error) {
      log.warn("review: GitLab refused to close the merge request", { iid, err: String(error) });
      return fail("review_unavailable");
    }
    recordDecision(getDb(), {
      iid,
      actorEmail: identity.email,
      action: "reject",
      paths: proposal.paths,
      selfApproval: false,
    });
    captureServerEvent("kb_review_decided", {
      distinctId: analyticsIdFor(identity.email),
      properties: { action: "reject", pathCount: proposal.paths.length, origin: proposal.origin },
    });
    return Response.json({ ok: true });
  }

  let merged: MergeOutcome;
  try {
    // The sha the queue read, so GitLab refuses if the branch moved since.
    merged = await getGitHost().mergeChangeRequest({ iid, token, sha: proposal.sha });
  } catch (error) {
    log.warn("review: could not reach GitLab to merge", { iid, err: String(error) });
    return fail("review_unavailable");
  }
  if (!merged.ok) {
    // `detail` takes literals only, so GitLab's own sentence is logged rather
    // than forwarded into the response body.
    log.warn("review: GitLab refused to merge", { iid, status: merged.status, reason: merged.reason });
    return fail("conflict", { detail: "merge_refused" });
  }

  // The direct-commit path's refresh sequence, then the artifact reconcile, so a
  // row sitting at in_review flips now rather than on the next poll.
  await refreshRepo();
  if (isIndexEnabled()) rebuildIndex();
  clearKbGraphCache();
  await reconcileInReviewArtifacts(getDb());

  const selfApproval = isSelfApproval(identity, proposal);
  recordDecision(getDb(), {
    iid,
    actorEmail: identity.email,
    action: "approve",
    paths: proposal.paths,
    selfApproval,
  });
  captureServerEvent("kb_review_decided", {
    distinctId: analyticsIdFor(identity.email),
    properties: {
      action: "approve",
      pathCount: proposal.paths.length,
      origin: proposal.origin,
      selfApproval,
    },
  });
  return Response.json({ ok: true });
}

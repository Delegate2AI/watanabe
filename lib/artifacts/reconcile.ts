import type { Database as DatabaseType } from "better-sqlite3";
import { getGitHost } from "@/lib/git-host";
import { listInReviewArtifacts, markProposalMerged, markProposalRejected } from "@/lib/db/artifacts-review";
import { isArtifactPublishEnabled } from "./config";
import { unfilteredVaultRoot } from "@/lib/repo";
import { readVaultFile } from "@/lib/vault";
import { log } from "@/lib/log";

/**
 * Is the merged note actually in the checkout the knowledge base serves from?
 *
 * `refreshRepo()` returns void and swallows every failure by contract, so having
 * called it proves nothing: it exits early for a local checkout, for missing read
 * credentials, and after any fetch or reset error. Promoting on that basis would
 * recreate the exact bug this whole branch started from, an artifact reported as
 * published whose note the knowledge base cannot find.
 *
 * So promotion is evidence-based instead. The read is against the UNFILTERED
 * vault, not a clearance projection, because this is a system job with no
 * requester and a note filed to a narrow group is still published.
 */
function noteIsInVault(publishedNotePath: string | null): boolean {
  if (!publishedNotePath) return false;
  // Note paths are stored `docs/<rel>`, and the vault root IS that `docs/`.
  const rel = publishedNotePath.replace(/^docs\//, "");
  if (!rel) return false;
  try {
    return readVaultFile(rel, unfilteredVaultRoot()) !== null;
  } catch {
    return false;
  }
}

export interface ReconcileResult {
  /** Artifacts promoted to `published` because their merge request merged. */
  promoted: number;
  /** Artifacts handed back to `ready` because their merge request was closed. */
  rejected: number;
  /** Artifacts left in review: still open, or GitLab could not be asked. */
  pending: number;
}

/**
 * Close the loop on `mr`-mode publishing (spec 27).
 *
 * A `direct` publish is live the moment it lands, so it goes straight to
 * `published`. An `mr` publish only PROPOSES the note, and nothing in this app
 * watched GitLab afterwards: a merged merge request left its artifact sitting at
 * `in_review` and frozen forever, and a closed one left it stuck with no way for
 * its author to revise and try again. This is the missing observer.
 *
 * Called wherever the read-serving checkout is refreshed, because that is
 * already exactly the "main may have moved" signal: the GitLab webhook
 * (`app/api/repo/refresh`) for immediacy, and the `REPO_REFRESH_INTERVAL_MS`
 * poll in `instrumentation.ts` as the backstop when no webhook is configured.
 * Run AFTER the refresh, so an artifact is only called published once the merged
 * content is actually in the checkout the knowledge base reads from.
 *
 * NEVER THROWS, and fails toward doing nothing. Every GitLab call is
 * individually guarded: a network error, an expired token or an unexpected
 * response leaves that artifact exactly as it was, to be retried on the next
 * refresh. The states that mean "not decided yet" (`opened`, and the transient
 * `locked` during a merge) are also left alone. Only an explicit `merged` or
 * `closed` moves anything, so an outage can never mis-promote a note into the
 * knowledge base or throw away someone's proposal.
 */
export async function reconcileInReviewArtifacts(db: DatabaseType): Promise<ReconcileResult> {
  const result: ReconcileResult = { promoted: 0, rejected: 0, pending: 0 };

  // Same gate as the publish path that creates these rows. Without it the
  // interval would open the artifact store, call GitLab and mutate review rows
  // on a deployment where the artifacts subsystem is switched off, so flag-off
  // would not be the no-op it is required to be.
  if (!isArtifactPublishEnabled()) return result;

  // The api-scoped token, the same one the publish path requires. Without it
  // there is nothing to ask GitLab with, and this is a no-op rather than an
  // error: a deployment with no write access has no merge requests to reconcile.
  const token = process.env.REPO_WRITE_TOKEN?.trim();
  if (!token) return result;

  let waiting: ReturnType<typeof listInReviewArtifacts>;
  try {
    waiting = listInReviewArtifacts(db);
  } catch (error) {
    log.warn("artifact reconcile could not read in-review artifacts", { err: String(error) });
    return result;
  }
  if (waiting.length === 0) return result;

  for (const artifact of waiting) {
    try {
      const { state } = await getGitHost().getChangeRequestState({ iid: artifact.mrIid, token });

      if (state === "merged") {
        // Merged upstream is not the same as present downstream: the checkout
        // may not have caught up, or may have failed to. Leave it pending and
        // try again on the next refresh rather than claiming a note is live
        // when the knowledge base still cannot serve it.
        if (!noteIsInVault(artifact.publishedNotePath)) {
          result.pending += 1;
          log.info("artifact merge seen but its note is not in the checkout yet", {
            artifactId: artifact.id,
            mrIid: artifact.mrIid,
          });
          continue;
        }
        if (markProposalMerged(db, artifact.id)) {
          result.promoted += 1;
          log.info("artifact published by merge", {
            artifactId: artifact.id,
            mrIid: artifact.mrIid,
            title: artifact.title,
          });
        }
        continue;
      }

      if (state === "closed") {
        if (markProposalRejected(db, artifact.id)) {
          result.rejected += 1;
          log.info("artifact proposal closed without merging, returned to ready", {
            artifactId: artifact.id,
            mrIid: artifact.mrIid,
            title: artifact.title,
          });
        }
        continue;
      }

      result.pending += 1;
    } catch (error) {
      // One unreachable merge request must not stop the rest being reconciled.
      result.pending += 1;
      log.warn("artifact reconcile could not read a merge request", {
        artifactId: artifact.id,
        mrIid: artifact.mrIid,
        err: String(error),
      });
    }
  }

  return result;
}

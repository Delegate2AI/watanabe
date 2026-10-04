import type { Database as DatabaseType } from "better-sqlite3";
import { findProposalOrigin } from "@/lib/db/review-enrichment";
import { getGitHost, type ChangedPath } from "@/lib/git-host";
import { log } from "@/lib/log";
import { clearedForChanges, touchesOnlyVault } from "./clearance";

export interface Proposal {
  iid: number;
  title: string;
  proposer: string;
  createdAt: string;
  webUrl: string;
  sourceBranch: string;
  /** The head commit the queue read, handed back on merge so a moved branch is refused. */
  sha: string;
  paths: string[];
  changes: ChangedPath[];
  origin: "artifact" | "shared-doc" | "chat";
}

/** `kb_submit` writes this sentence into every chat proposal's description. */
const CHAT_ATTRIBUTION = /KB chat assistant by (.+?)\.\s*$/;

function proposerFromDescription(description: string, fallback: string): string {
  return description.match(CHAT_ATTRIBUTION)?.[1]?.trim() || fallback;
}

/**
 * Every open merge request this person may review: vault-only, cleared for them,
 * enriched from SQLite where a publish row happens to exist. Throws when GitLab
 * cannot be listed, so the route answers `review_unavailable` rather than
 * showing an empty queue that looks like "nothing to review".
 */
export async function loadProposals(db: DatabaseType, email: string): Promise<Proposal[]> {
  const token = process.env.REPO_WRITE_TOKEN?.trim();
  if (!token) return [];

  const host = getGitHost();
  const open = await host.listOpenChangeRequests({ token });
  const proposals: Proposal[] = [];

  for (const mr of open) {
    let changes: ChangedPath[];
    try {
      const read = await host.getChangeRequestChanges({ iid: mr.iid, token });
      // A diff GitLab truncated cannot be authorized against: the paths it left
      // out could be anywhere, so this one is reviewed in GitLab, not here.
      if (read.truncated) {
        log.warn("review: merge request diff was truncated by GitLab", { iid: mr.iid });
        continue;
      }
      changes = read.changes;
    } catch (error) {
      // One unreadable merge request must not empty the whole queue.
      log.warn("review: could not read merge request changes", {
        iid: mr.iid,
        err: String(error),
      });
      continue;
    }
    if (!touchesOnlyVault(changes)) continue;
    if (!clearedForChanges(email, changes)) continue;

    const enriched = findProposalOrigin(db, { iid: mr.iid, webUrl: mr.webUrl });
    proposals.push({
      iid: mr.iid,
      title: mr.title,
      proposer: enriched?.owner ?? proposerFromDescription(mr.description, mr.authorName),
      createdAt: mr.createdAt,
      webUrl: mr.webUrl,
      sourceBranch: mr.sourceBranch,
      sha: mr.sha,
      paths: changes.map((c) => (c.deletedFile ? c.oldPath : c.newPath)),
      changes,
      origin: enriched?.origin ?? "chat",
    });
  }

  return proposals;
}

/**
 * The authorization primitive for acting on one proposal. An iid that does not
 * exist and one the requester is not cleared for both answer null, so the queue
 * cannot be used to discover proposals against notes you cannot see.
 */
export async function loadProposal(
  db: DatabaseType,
  email: string,
  iid: number,
): Promise<Proposal | null> {
  const proposals = await loadProposals(db, email);
  return proposals.find((p) => p.iid === iid) ?? null;
}

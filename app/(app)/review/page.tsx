import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GitPullRequest } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { ProposalList } from "@/components/review/proposal-list";
import { can } from "@/lib/authority/roles";
import { getGitHost } from "@/lib/git-host";
import { getDb } from "@/lib/db/client";
import { resolveIdentity } from "@/lib/identity/resolve";
import { viewerName } from "@/lib/people/resolve";
import { isKbReviewEnabled } from "@/lib/review/config";
import { loadProposals, type Proposal } from "@/lib/review/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EYEBROW = "Review";
const TITLE = "Changes waiting on you";
const DESCRIPTION =
  "Knowledge-base changes people have proposed. Read the change, then merge it into the knowledge base or send it back.";

/**
 * The approver's review queue. Both gates are re-derived by the routes the list
 * calls, so nothing here is the authorization: this only decides what is drawn.
 */
export default async function ReviewPage() {
  if (!isKbReviewEnabled()) {
    return (
      <RouteScaffold
        icon={GitPullRequest}
        eyebrow={EYEBROW}
        title={TITLE}
        description={DESCRIPTION}
        spec="the 2026-08-18 review design"
        flag="KB_REVIEW_ENABLED"
      />
    );
  }

  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  if (!can(identity.email, "approve")) notFound();

  let proposals: Proposal[] = [];
  let loadFailed = false;
  try {
    proposals = await loadProposals(getDb(), identity.email);
  } catch {
    loadFailed = true;
  }

  const { name } = viewerName(identity.email, identity.name);

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={GitPullRequest}
        eyebrow={EYEBROW}
        title={TITLE}
        description={DESCRIPTION}
      />
      <ProposalList
        proposals={proposals}
        viewer={{ email: identity.email, name }}
        loadFailed={loadFailed}
        terms={getGitHost().terms}
      />
    </div>
  );
}

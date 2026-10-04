"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { codeFromBody, messageFor, messageForBody } from "@/lib/errors/messages";
import { GITLAB_TERMS } from "@/lib/git-host/terms";
import type { ChangeRequestTerms } from "@/lib/git-host/types";
import type { Proposal } from "@/lib/review/queue";
import { ProposalCard, isSelfProposal } from "./proposal-card";

function mergeRefused(terms: ChangeRequestTerms): string {
  return `The merge was refused, so this is still waiting. Open the ${terms.long} to see why.`;
}

function detailOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: { detail?: unknown } }).error;
  const detail = error && typeof error === "object" ? error.detail : undefined;
  return typeof detail === "string" ? detail : undefined;
}

function failureMessage(body: unknown, terms: ChangeRequestTerms): string {
  if (codeFromBody(body) === "conflict" && detailOf(body) === "merge_refused") return mergeRefused(terms);
  return messageForBody(body);
}

/**
 * The approver's queue. It owns the pending and failure state: one decision is
 * in flight at a time, and a decision that failed leaves its proposal on screen.
 */
export function ProposalList({
  proposals,
  viewer,
  loadFailed,
  terms = GITLAB_TERMS,
}: {
  proposals: Proposal[];
  viewer: { email: string; name: string };
  loadFailed?: boolean;
  terms?: ChangeRequestTerms;
}) {
  const router = useRouter();
  const [decided, setDecided] = useState<number[]>([]);
  const [pending, setPending] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ iid: number; message: string } | null>(null);

  const visible = proposals.filter((proposal) => !decided.includes(proposal.iid));

  async function decide(iid: number, action: "approve" | "reject"): Promise<void> {
    setPending(iid);
    setFailure(null);
    try {
      const res = await fetch(`/api/review/${iid}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFailure({ iid, message: failureMessage(body, terms) });
        return;
      }
      setDecided((current) => [...current, iid]);
      // The sidebar badge and any surface reading the vault are stale now.
      router.refresh();
    } catch {
      setFailure({ iid, message: messageFor("internal") });
    } finally {
      setPending(null);
    }
  }

  if (loadFailed) {
    return (
      <p
        role="alert"
        className="rounded-card border border-line bg-surface-2 px-5 py-8 text-center text-sm text-warn"
      >
        {messageFor("review_unavailable")}
      </p>
    );
  }

  if (visible.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-muted">
        Nothing is waiting on review.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {visible.map((proposal) => (
        <ProposalCard
          key={proposal.iid}
          proposal={proposal}
          isSelf={isSelfProposal(proposal.proposer, viewer)}
          busy={pending !== null}
          error={failure?.iid === proposal.iid ? failure.message : null}
          onDecide={(action) => void decide(proposal.iid, action)}
          terms={terms}
        />
      ))}
    </div>
  );
}

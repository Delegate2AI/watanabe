import { ExternalLink } from "lucide-react";
import { formatDateTime, formatRelative } from "@/lib/ui/date";
import { GITLAB_TERMS } from "@/lib/git-host/terms";
import type { ChangeRequestTerms } from "@/lib/git-host/types";
import type { Proposal } from "@/lib/review/queue";
import { DiffView } from "./diff-view";

const actionClass =
  "min-h-9 rounded-lg px-3 text-sm font-medium transition active:scale-[0.97] disabled:opacity-45";

/**
 * Whether the viewer is the person this proposal is attributed to. A chat
 * proposal names a display name, an artifact or shared-doc publish names the
 * owner's address, so both are compared.
 */
export function isSelfProposal(
  proposer: string,
  viewer: { email: string; name: string },
): boolean {
  const claimed = proposer.trim().toLowerCase();
  if (claimed === "") return false;
  return claimed === viewer.email.trim().toLowerCase() || claimed === viewer.name.trim().toLowerCase();
}

/** The path a change lands on, which for a removal is the path it leaves. */
function pathOf(change: Proposal["changes"][number]): string {
  return change.deletedFile ? change.oldPath : change.newPath;
}

function statusOf(change: Proposal["changes"][number]): string | null {
  if (change.newFile) return "new";
  if (change.deletedFile) return "removed";
  if (change.renamedFile) return "renamed";
  return null;
}

export function ProposalCard({
  proposal,
  isSelf,
  busy,
  error,
  onDecide,
  terms = GITLAB_TERMS,
}: {
  proposal: Proposal;
  isSelf: boolean;
  busy: boolean;
  error?: string | null;
  onDecide: (action: "approve" | "reject") => void;
  terms?: ChangeRequestTerms;
}) {
  return (
    <article className="rounded-card border border-line bg-surface p-5 shadow-card">
      <header className="mb-3">
        <h3 className="text-base font-medium text-ink">{proposal.title}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span>{proposal.proposer}</span>
          <span aria-hidden>&middot;</span>
          <time dateTime={proposal.createdAt} title={formatDateTime(proposal.createdAt)}>
            {formatRelative(proposal.createdAt)}
          </time>
          {isSelf ? (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">
              You proposed this
            </span>
          ) : null}
        </p>
      </header>

      <ul className="mb-3 flex flex-col gap-1">
        {proposal.changes.map((change) => (
          <li key={pathOf(change)} className="flex items-center gap-2 text-xs">
            <code className="break-all text-ink">{pathOf(change)}</code>
            {statusOf(change) ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
                {statusOf(change)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        {proposal.changes.map((change) => (
          <DiffView key={pathOf(change)} diff={change.diff} />
        ))}
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-warn">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${actionClass} bg-accent text-white`}
          disabled={busy}
          onClick={() => onDecide("approve")}
        >
          Approve
        </button>
        <button
          type="button"
          className={`${actionClass} border border-line text-ink`}
          disabled={busy}
          onClick={() => onDecide("reject")}
        >
          Reject
        </button>
        <a
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted underline hover:text-ink"
          href={proposal.webUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the {terms.long}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
    </article>
  );
}

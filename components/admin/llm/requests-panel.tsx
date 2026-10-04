"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTokens } from "@/lib/llm/format";
import type { DecisionAction } from "@/lib/llm/requests";
import type { AdminRequestView } from "@/lib/llm/view-types";
import { adminCall, button, card, danger, input, primary } from "./api";

function PendingRequest({ request }: { request: AdminRequestView }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(request.requestedTokens));
  const tokens = Math.floor(Number(amount));
  const validAmount = Number.isFinite(tokens) && tokens >= 1;
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  async function decide(action: DecisionAction) {
    setPending(true);
    const ok = await adminCall("POST", "/api/admin/llm/requests", { id: request.id, action, tokens, note }, "Decision saved.");
    setPending(false);
    if (ok) router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium text-ink">{request.requesterEmail}</span>
        <span className="text-ink-muted">wants +{formatTokens(request.requestedTokens)} for {request.groupLabel}</span>
        <span className="ml-auto text-xs text-ink-faint">
          now {formatTokens(request.used)} of {request.limit === null ? "unlimited" : formatTokens(request.limit)} per {request.period}
        </span>
      </div>
      <p className="text-sm text-ink-muted">{request.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${input} w-36`}
          aria-label="Tokens to grant"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} className={`${input} min-w-0 flex-1`} />
        <button type="button" disabled={pending || !validAmount} onClick={() => decide("approve_permanent")} className={primary}>
          Raise permanently
        </button>
        <button type="button" disabled={pending || !validAmount} onClick={() => decide("approve_top_up")} className={button}>
          Top up this {request.period}
        </button>
        <button type="button" disabled={pending} onClick={() => decide("reject")} className={danger}>
          Reject
        </button>
      </div>
    </li>
  );
}

/** Pending budget requests first; decided ones below. Deciding also completes the request's task. */
export function RequestsPanel({ requests }: { requests: AdminRequestView[] }) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 50);
  return (
    <div id="requests" className={card}>
      <h2 className="text-sm font-semibold text-ink">Budget requests</h2>
      {pending.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing waiting.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {pending.map((r) => (
            <PendingRequest key={r.id} request={r} />
          ))}
        </ul>
      )}
      {decided.length > 0 ? (
        <>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-faint">Decided</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-2 text-ink-muted">
                <span className="text-ink">{r.requesterEmail}</span>
                <span>+{formatTokens(r.requestedTokens)} {r.groupLabel}</span>
                <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs">
                  {r.status === "approved" ? `${r.decision === "top_up" ? "top-up" : "raise"} +${formatTokens(r.grantedTokens ?? 0)}` : "rejected"}
                </span>
                <span className="text-xs text-ink-faint">by {r.decidedBy}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

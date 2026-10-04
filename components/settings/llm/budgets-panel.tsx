"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import type { BudgetRequest } from "@/lib/db/llm-requests";
import { messageForBody } from "@/lib/errors/messages";
import { formatTokens, usedPercent } from "@/lib/llm/format";
import type { UserBudgetView } from "@/lib/llm/view-types";
import { formatDateTime } from "@/lib/ui/date";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";

const card = "rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]";
const PRESETS = [100_000, 1_000_000, 10_000_000];

function RequestForm({ budget, onDone }: { budget: UserBudgetView; onDone: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(PRESETS[1]));
  const tokens = Math.floor(Number(amount));
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/settings/llm-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupSlug: budget.groupSlug, tokens, reason }),
      });
      if (!response.ok) return notifyFailure(messageForBody(await response.json().catch(() => null)));
      notifySuccess("Request sent to the admins.");
      onDone();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(String(p))}
            className={`rounded-md border px-2 py-1 text-xs ${tokens === p ? "border-accent text-accent" : "border-line text-ink-muted"}`}
          >
            +{formatTokens(p)}
          </button>
        ))}
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 w-36 rounded-control border border-line bg-surface px-2 text-sm text-ink"
          aria-label="Tokens"
        />
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="What is it for?"
        className="rounded-control border border-line bg-surface px-2 py-1 text-sm text-ink"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending || !reason.trim() || !(tokens >= 1)} className="h-8 rounded-control bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">
          Send request
        </button>
        <button type="button" onClick={onDone} className="h-8 px-2 text-sm text-ink-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}

function BudgetRow({ budget }: { budget: UserBudgetView }) {
  const [asking, setAsking] = useState(false);
  const limit = budget.tokens === null ? null : budget.tokens + budget.bonus;
  const pct = usedPercent(budget.used, limit);
  return (
    <li className="flex flex-col gap-1.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium text-ink">{budget.label}</span>
        <span className="text-xs text-ink-faint">{budget.models.join(", ")}</span>
        <span className="ml-auto text-xs text-ink-muted">
          {limit === null
            ? `${formatTokens(budget.used)} used, unlimited`
            : `${formatTokens(budget.used)} of ${formatTokens(limit)} per ${budget.period}${budget.bonus ? ` (incl. +${formatTokens(budget.bonus)} top-up)` : ""}`}
        </span>
      </div>
      {limit !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${pct >= 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        Resets {formatDateTime(budget.resetAt)}
        {limit !== null && !asking ? (
          <button type="button" onClick={() => setAsking(true)} className="ml-auto text-accent hover:underline">
            Request more
          </button>
        ) : null}
      </div>
      {asking ? <RequestForm budget={budget} onDone={() => setAsking(false)} /> : null}
    </li>
  );
}

/** What each allowed model group has left this period, with requests for more. */
export function BudgetsPanel({ budgets, requests }: { budgets: UserBudgetView[]; requests: BudgetRequest[] }) {
  const labels = new Map(budgets.map((b) => [b.groupSlug, b.label]));
  return (
    <div className={card}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Gauge className="size-4 text-accent" />
        Your budgets
      </h2>
      {budgets.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No models are available to you yet. Ask an admin to add you to a model group.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {budgets.map((b) => (
            <BudgetRow key={b.groupSlug} budget={b} />
          ))}
        </ul>
      )}
      {requests.length > 0 ? (
        <>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-faint">Your requests</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-2">
                <span className="text-ink">+{formatTokens(r.requestedTokens)} for {labels.get(r.groupSlug) ?? r.groupSlug}</span>
                <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
                  {r.status === "approved" ? `approved${r.decision === "top_up" ? " as a top-up" : " as a raise"}` : r.status}
                </span>
                {r.decisionNote ? <span className="text-xs text-ink-faint">{r.decisionNote}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

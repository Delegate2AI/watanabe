"use client";

import { useState } from "react";
import { formatTokens } from "@/lib/llm/format";
import { LLM_PERIODS, type BudgetRow, type LlmPeriod } from "@/lib/llm/types";
import { button, danger, input, primary } from "./api";

type Mode = "tokens" | "unlimited" | "blocked";

export function describeBudget(row: Pick<BudgetRow, "tokens" | "period" | "allowed"> | undefined): string {
  if (!row) return "default";
  if (!row.allowed) return "blocked";
  return row.tokens === null ? `unlimited / ${row.period}` : `${formatTokens(row.tokens)} / ${row.period}`;
}

/** Edits one budget: a token amount, unlimited or blocked, and a period. */
export function BudgetEditor({
  row,
  onSave,
  onClear,
  onCancel,
}: {
  row: BudgetRow | undefined;
  onSave: (value: { tokens: number | null; period: LlmPeriod; allowed: boolean }) => Promise<void>;
  onClear: (() => Promise<void>) | null;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>(!row ? "tokens" : !row.allowed ? "blocked" : row.tokens === null ? "unlimited" : "tokens");
  const [amount, setAmount] = useState(String(row?.tokens ?? 1_000_000));
  const tokens = Math.floor(Number(amount));
  const [period, setPeriod] = useState<LlmPeriod>(row?.period ?? "month");
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<void>) {
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2">
      <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input} aria-label="Budget kind">
        <option value="tokens">Tokens</option>
        <option value="unlimited">Unlimited</option>
        <option value="blocked">Blocked</option>
      </select>
      {mode === "tokens" ? (
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${input} w-36`}
          aria-label="Tokens"
        />
      ) : null}
      {mode !== "blocked" ? (
        <select value={period} onChange={(e) => setPeriod(e.target.value as LlmPeriod)} className={input} aria-label="Period">
          {LLM_PERIODS.map((p) => (
            <option key={p} value={p}>
              per {p}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={pending || (mode === "tokens" && !(amount.trim() !== "" && tokens >= 0))}
        className={primary}
        onClick={() =>
          run(() => onSave({ tokens: mode === "tokens" ? tokens : null, period, allowed: mode !== "blocked" }))
        }
      >
        Save
      </button>
      {onClear ? (
        <button type="button" disabled={pending} className={danger} onClick={() => run(onClear)}>
          Clear
        </button>
      ) : null}
      <button type="button" className={button} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

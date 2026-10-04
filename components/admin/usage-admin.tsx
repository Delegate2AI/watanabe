"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Person } from "@/lib/people/types";
import type { OwnerThreadUsage, UsageSummary } from "@/lib/usage/types";
import { UsageTables, money } from "./usage-tables";

const PRESETS: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function shiftDays(to: string, days: number): string {
  const start = new Date(`${to}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

function Tile({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="rounded-menu border border-line bg-surface px-4 py-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

export function UsageAdmin({
  initial,
  people,
  viewerEmail,
}: {
  initial: UsageSummary;
  people: Record<string, Person>;
  viewerEmail: string;
}): ReactNode {
  const [summary, setSummary] = useState(initial);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [threads, setThreads] = useState<OwnerThreadUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRequestRef = useRef(0);
  const drillRequestRef = useRef(0);

  async function load(nextFrom: string, nextTo: string): Promise<void> {
    const requestId = (summaryRequestRef.current += 1);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/usage?from=${nextFrom}&to=${nextTo}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as UsageSummary;
      if (summaryRequestRef.current !== requestId) return;
      drillRequestRef.current += 1;
      setSummary(body);
      setFrom(nextFrom);
      setTo(nextTo);
      setExpanded(null);
      setThreads([]);
    } catch {
      if (summaryRequestRef.current === requestId) setError("Could not load that period.");
    } finally {
      if (summaryRequestRef.current === requestId) setBusy(false);
    }
  }

  async function toggleOwner(email: string): Promise<void> {
    if (expanded === email) {
      drillRequestRef.current += 1;
      setExpanded(null);
      setThreads([]);
      return;
    }
    const requestId = (drillRequestRef.current += 1);
    const drillFrom = from;
    const drillTo = to;
    setExpanded(email);
    setThreads([]);
    try {
      const response = await fetch(
        `/api/admin/usage?view=threads&owner=${encodeURIComponent(email)}&from=${drillFrom}&to=${drillTo}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { threads: OwnerThreadUsage[] };
      if (drillRequestRef.current !== requestId) return;
      setThreads(body.threads);
    } catch {
      if (drillRequestRef.current === requestId) setError("Could not load that person's threads.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.days}
            className="rounded-menu border border-line px-3 py-1.5 text-[13px] hover:bg-surface-2"
            disabled={busy}
            onClick={() => void load(shiftDays(to, preset.days), to)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
        <label className="text-xs text-ink-faint">
          From
          <input
            aria-label="From"
            className="ml-1 rounded-menu border border-line bg-surface px-2 py-1 text-[13px]"
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className="text-xs text-ink-faint">
          To
          <input
            aria-label="To"
            className="ml-1 rounded-menu border border-line bg-surface px-2 py-1 text-[13px]"
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </label>
        <button
          className="rounded-menu border border-line px-3 py-1.5 text-[13px] hover:bg-surface-2"
          disabled={busy}
          onClick={() => void load(from, to)}
          type="button"
        >
          Apply
        </button>
        <a
          className="rounded-menu border border-line px-3 py-1.5 text-[13px] hover:bg-surface-2"
          href={`/api/admin/usage?view=csv&from=${summary.from}&to=${summary.to}`}
        >
          Export CSV
        </a>
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        {summary.from} to {summary.to}, UTC day boundaries. Figures are the SDK list-price computation, not the invoice.
      </p>
      {error === null ? null : <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Users" value={money(summary.users.costUsd)} />
        <Tile label="System" value={money(summary.system.costUsd)} />
        <Tile label="Total" value={money(summary.grand.costUsd)} />
        <Tile label="Turns" value={String(summary.grand.turns)} />
      </div>

      <UsageTables
        expanded={expanded}
        onToggleOwner={(email) => void toggleOwner(email)}
        people={people}
        summary={summary}
        threads={threads}
        viewerEmail={viewerEmail}
      />
    </div>
  );
}

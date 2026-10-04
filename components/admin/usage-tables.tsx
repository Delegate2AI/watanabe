"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { PersonChip, personFor } from "@/components/person-chip";
import type { Person } from "@/lib/people/types";
import type { OwnerThreadUsage, UsageSummary } from "@/lib/usage/types";

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function tokens(value: number): string {
  return value.toLocaleString("en-US");
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      <div className="overflow-x-auto rounded-menu border border-line">
        <table className="w-full min-w-[42rem] text-left text-[13px]">{children}</table>
      </div>
    </section>
  );
}

function ThreadRows({ threads }: { threads: OwnerThreadUsage[] }): ReactNode {
  if (threads.length === 0) {
    return (
      <tr>
        <td className="px-3 py-2 text-ink-faint" colSpan={7}>
          No threads in this period.
        </td>
      </tr>
    );
  }
  return (
    <>
      {threads.map((thread) => (
        <tr key={`${thread.threadId}-${thread.source}`} className="border-t border-line-soft bg-surface-2">
          <td className="px-3 py-2 pl-8">
            {thread.title === null ? (
              <span className="text-ink-faint">deleted thread</span>
            ) : (
              <Link className="hover:underline" href={`/chat/${thread.threadId}`}>
                {thread.title}
              </Link>
            )}
          </td>
          <td className="px-3 py-2 text-ink-faint">{thread.source}</td>
          <td className="px-3 py-2">{thread.turns}</td>
          <td className="px-3 py-2" colSpan={3}>
            {thread.lastAt.slice(0, 16).replace("T", " ")} UTC
          </td>
          <td className="px-3 py-2">{money(thread.costUsd)}</td>
        </tr>
      ))}
    </>
  );
}

export function UsageTables({
  summary,
  people,
  viewerEmail,
  expanded,
  threads,
  onToggleOwner,
}: {
  summary: UsageSummary;
  people: Record<string, Person>;
  viewerEmail: string;
  expanded: string | null;
  threads: OwnerThreadUsage[];
  onToggleOwner: (email: string) => void;
}): ReactNode {
  return (
    <>
      <Section title="By user">
        <thead className="text-ink-faint">
          <tr>
            <th className="px-3 py-2 font-medium">Person</th>
            <th className="px-3 py-2 font-medium">Top model</th>
            <th className="px-3 py-2 font-medium">Turns</th>
            <th className="px-3 py-2 font-medium">Input</th>
            <th className="px-3 py-2 font-medium">Output</th>
            <th className="px-3 py-2 font-medium">Cached</th>
            <th className="px-3 py-2 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {summary.owners.map((owner) => (
            <tr key={owner.ownerEmail} className="border-t border-line-soft">
              <td className="px-3 py-2">
                <button className="text-left hover:underline" onClick={() => onToggleOwner(owner.ownerEmail)} type="button">
                  <PersonChip
                    person={{ ...personFor(people, owner.ownerEmail), isSelf: owner.ownerEmail === viewerEmail }}
                  />
                </button>
              </td>
              <td className="px-3 py-2 text-ink-faint">{owner.topModel ?? ""}</td>
              <td className="px-3 py-2">{owner.turns}</td>
              <td className="px-3 py-2">{tokens(owner.inputTokens)}</td>
              <td className="px-3 py-2">{tokens(owner.outputTokens)}</td>
              <td className="px-3 py-2">{tokens(owner.cacheReadTokens + owner.cacheCreationTokens)}</td>
              <td className="px-3 py-2">{money(owner.costUsd)}</td>
            </tr>
          ))}
          {expanded === null ? null : <ThreadRows threads={threads} />}
        </tbody>
      </Section>

      <Section title="System">
        <thead className="text-ink-faint">
          <tr>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Turns</th>
            <th className="px-3 py-2 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {summary.sources.map((row) => (
            <tr key={row.source} className="border-t border-line-soft">
              <td className="px-3 py-2">{row.source}</td>
              <td className="px-3 py-2">{row.turns}</td>
              <td className="px-3 py-2">{money(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="By model">
        <thead className="text-ink-faint">
          <tr>
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 font-medium">Turns</th>
            <th className="px-3 py-2 font-medium">Input</th>
            <th className="px-3 py-2 font-medium">Output</th>
            <th className="px-3 py-2 font-medium">Cost</th>
            <th className="px-3 py-2 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {summary.models.map((row) => (
            <tr key={row.model} className="border-t border-line-soft">
              <td className="px-3 py-2">{row.model}</td>
              <td className="px-3 py-2">{row.turns}</td>
              <td className="px-3 py-2">{tokens(row.inputTokens)}</td>
              <td className="px-3 py-2">{tokens(row.outputTokens)}</td>
              <td className="px-3 py-2">{money(row.costUsd)}</td>
              <td className="px-3 py-2">
                {summary.grand.costUsd === 0 ? "0%" : `${Math.round((row.costUsd / summary.grand.costUsd) * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </Section>
    </>
  );
}

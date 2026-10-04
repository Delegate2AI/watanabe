"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";
import { useChangeRequestTerms } from "@/components/app-config-provider";

const buttonClass = "min-h-9 rounded-lg px-3 text-xs font-medium transition-[scale,background-color] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45";
const chipClass = "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs";

export function ReclearControl({
  notePath,
  visibilityGroups,
  unresolvedAttendees,
  availableGroups,
}: {
  notePath: string;
  visibilityGroups: string[];
  unresolvedAttendees: string[];
  availableGroups: string[];
}) {
  const terms = useChangeRequestTerms();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(visibilityGroups);
  const [pending, setPending] = useState(false);
  // The outcome, not just a sentence: a successful submission carries the merge
  // request a reviewer acts on, and the branch name alone was not something an
  // admin could act on from here.
  const [outcome, setOutcome] = useState<{ text: string; mrUrl?: string } | null>(null);

  function toggle(group: string): void {
    setSelected((current) =>
      current.includes(group) ? current.filter((value) => value !== group) : [...current, group],
    );
  }

  async function submit(): Promise<void> {
    setPending(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/meetings/reclear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notePath, visibility: selected }),
      });
      const result = (await response.json()) as { error?: unknown; branch?: string; mrUrl?: string };
      setOutcome(
        response.ok
          ? {
              // Deliberately not "applied": the note keeps its old clearance
              // until someone merges. The branch name is gone from this copy
              // because the link is the thing to act on.
              text: "Submitted for review. Merge it to apply the new clearance.",
              ...(typeof result.mrUrl === "string" ? { mrUrl: result.mrUrl } : {}),
            }
          : { text: messageForBody(result) },
      );
    } catch {
      setOutcome({ text: "Re-clearance could not be submitted." });
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass} border border-line text-ink-muted hover:bg-surface-hover`}>
        Edit visibility
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-xl border border-line bg-surface-2 p-3">
      {unresolvedAttendees.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warn">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Restricted because these attendees are not in any known group: {unresolvedAttendees.join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {availableGroups.map((group) => (
          <label key={group} className={`${chipClass} cursor-pointer ${selected.includes(group) ? "bg-accent-soft text-accent" : "text-ink-muted"}`}>
            <input
              type="checkbox"
              className="size-3.5"
              checked={selected.includes(group)}
              onChange={() => toggle(group)}
              disabled={pending}
            />
            {group}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void submit()} disabled={pending || selected.length === 0} className={`${buttonClass} bg-accent text-white`}>
          Submit for review
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className={`${buttonClass} text-ink-muted hover:bg-surface-hover`}>
          Cancel
        </button>
      </div>
      {outcome && (
        <p role="status" className="text-xs text-ink-muted">
          {outcome.text}
          {outcome.mrUrl ? (
            <>
              {" "}
              <a
                href={outcome.mrUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink underline"
              >
                Open {terms.long}
              </a>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

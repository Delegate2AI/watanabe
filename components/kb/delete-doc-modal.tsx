"use client";

import { useState } from "react";
import { messageForBody } from "@/lib/errors/messages";
import { useChangeRequestTerms } from "@/components/app-config-provider";

const overlay = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4";
const panel = "w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg";
const buttonClass = "min-h-9 rounded-lg px-3 text-sm font-medium transition active:scale-[0.97] disabled:opacity-45";

/**
 * A deletion is a proposal: this opens a merge request removing the note, which
 * an approver still has to merge. The copy has to say so, or the reader will
 * read the confirmation as the removal.
 */
export function DeleteDocModal({ path, onClose }: { path: string; onClose: () => void }) {
  const terms = useChangeRequestTerms();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mrUrl, setMrUrl] = useState<string | null>(null);

  async function propose(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/kb/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const json = (await res.json()) as { error?: unknown; mrUrl?: string };
      if (!res.ok) {
        setError(messageForBody(json));
        return;
      }
      setMrUrl(json.mrUrl ?? null);
    } catch {
      setError("The deletion could not be proposed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={overlay} role="dialog" aria-modal="true" aria-label="Delete document" onClick={onClose}>
      <div className={panel} onClick={(event) => event.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink">Delete document</h2>
        <p className="mt-1 break-all text-xs text-ink-faint">{path}</p>
        {mrUrl ? (
          <p className="mt-4 text-sm text-ink">
            The removal is proposed. An approver can act on it in{" "}
            <a className="underline" href="/review">
              Review
            </a>
            , or open the{" "}
            <a className="underline" href={mrUrl} target="_blank" rel="noreferrer">
              {terms.long}
            </a>
            .
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            This opens a {terms.long} removing the document. It stays in the knowledge base until
            an approver merges that request.
          </p>
        )}
        {error ? <p role="alert" className="mt-3 text-sm text-warn">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={`${buttonClass} border border-line text-ink`} onClick={onClose}>
            {mrUrl ? "Close" : "Cancel"}
          </button>
          {mrUrl ? null : (
            <button
              type="button"
              className={`${buttonClass} bg-warn text-white`}
              disabled={pending}
              onClick={propose}
            >
              {pending ? "Proposing..." : "Propose deletion"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

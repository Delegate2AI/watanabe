"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";
import type { DocAccessRequest, SharedAccess } from "@/lib/shared-docs/types";

const LEVELS: Array<{ value: SharedAccess; label: string; hint: string }> = [
  { value: "view", label: "Viewer", hint: "Read the document." },
  { value: "comment", label: "Commenter", hint: "Read it and leave comments." },
  { value: "edit", label: "Editor", hint: "Read, comment, and change it." },
];

/**
 * The "You need access" screen: what someone sees when they open a document
 * they are not on. Rendered by the page in place of a 404, and only with
 * `DOC_ACCESS_REQUESTS_ENABLED` on.
 *
 * It names nothing about the document, not its title and not its owner, because
 * the person reading it has no access to any of that yet. The one fact it
 * discloses is that the id they were given resolves to something, which is the
 * whole point of the screen.
 *
 * `standing` is the request this person already has open, so a reload shows
 * "your request is waiting" rather than an empty form inviting a duplicate.
 */
export function RequestAccess({
  docId,
  standing = null,
}: {
  docId: string;
  standing?: DocAccessRequest | null;
}) {
  const [access, setAccess] = useState<SharedAccess>(standing?.access ?? "view");
  const [message, setMessage] = useState(standing?.message ?? "");
  const [sent, setSent] = useState<DocAccessRequest | null>(standing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/docs/${encodeURIComponent(docId)}/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access, message: message.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(messageForBody(body));
        return;
      }
      setSent((body as { request: DocAccessRequest }).request);
    } catch {
      setError("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-16 pt-16">
      <div className="mb-6 grid size-10 place-items-center rounded-full border border-line bg-surface-2 text-ink-muted">
        <Lock className="size-5" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold text-ink">You need access</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {sent
          ? "Your request is with the document's owner. You will be able to open it once they grant access."
          : "Ask the owner of this document for access, or open it with an account that already has it."}
      </p>

      {sent ? (
        <p className="mt-6 rounded-chip border border-line bg-surface-2 px-4 py-3 text-sm text-ink">
          Requested {LEVELS.find((l) => l.value === sent.access)?.label.toLowerCase() ?? sent.access} access.
          <button
            type="button"
            onClick={() => setSent(null)}
            className="ml-2 font-medium text-accent underline"
          >
            Change the request
          </button>
        </p>
      ) : (
        <>
          <fieldset className="mt-6">
            <legend className="sr-only">Access level</legend>
            {LEVELS.map((level) => (
              <label key={level.value} className="mb-1 flex cursor-pointer items-baseline gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="access"
                  value={level.value}
                  checked={access === level.value}
                  disabled={busy}
                  onChange={() => setAccess(level.value)}
                />
                <span className="font-medium">{level.label}</span>
                <span className="text-xs text-ink-faint">{level.hint}</span>
              </label>
            ))}
          </fieldset>

          <label className="mt-4 block text-xs font-medium text-ink-muted">
            Message (optional)
            <textarea
              value={message}
              rows={3}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Why you need this"
              className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
            />
          </label>

          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="mt-4 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Sending..." : "Request access"}
          </button>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}

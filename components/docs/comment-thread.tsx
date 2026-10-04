"use client";

import { useState } from "react";
import type { CommentThread } from "@/lib/shared-docs/types";
import type { Person } from "@/lib/people/types";
import { mentionSegments } from "@/lib/shared-docs/mentions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PersonChip, personFor } from "@/components/person-chip";
import { formatDateTime, formatRelative } from "@/lib/ui/date";
import { cn } from "@/lib/utils";

function Body({ body }: { body: string }) {
  return (
    <span className="mt-0.5 block whitespace-pre-wrap break-words text-ink">
      {mentionSegments(body).map((s, i) =>
        s.mention ? (
          <span key={i} className="rounded bg-accent/15 px-1 text-accent">{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * One comment thread card (spec 2026-07-22, redesign; surface-polish P-09): an
 * avatar-led message list plus, when the caller has comment access, a reply box
 * and a resolve/reopen toggle. Resolved threads dim in place.
 *
 * People and dates go through the shared renderers rather than the local
 * email-splitting and initials helpers this file used to carry, so a comment
 * names someone exactly the way every other surface does, and every message now
 * says when it was written.
 */
export function CommentThreadCard({
  thread, canComment, onReply, onResolve, people = {},
}: {
  thread: CommentThread;
  canComment: boolean;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string, status: "open" | "resolved") => Promise<void>;
  /** Resolved server-side: <PersonChip> never resolves for itself. */
  people?: Record<string, Person>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reply() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await onReply(thread.id, body);
      setDraft("");
    } catch {
      // Keep the draft: the reply was not stored, so nothing to clear.
      setError("Could not post your reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-card border p-3 text-sm transition-colors",
        thread.status === "resolved"
          ? "border-line-soft bg-surface-2/60 opacity-70"
          : "border-line bg-surface shadow-card",
      )}
    >
      <ul className="flex flex-col gap-3">
        {thread.messages.map((m) => {
          const person = personFor(people, m.authorEmail.trim().toLowerCase());
          return (
            <li key={m.id} className="flex gap-2">
              <Avatar className="size-6">
                <AvatarFallback className="text-[10px]">{person.initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-xs font-medium text-ink">
                  <PersonChip person={person} />
                  <time
                    dateTime={m.createdAt}
                    title={formatDateTime(m.createdAt)}
                    className="ml-auto shrink-0 font-normal text-ink-faint"
                  >
                    {formatRelative(m.createdAt)}
                  </time>
                </span>
                <Body body={m.body} />
              </div>
            </li>
          );
        })}
      </ul>
      {canComment && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply"
            className="min-h-[44px] w-full rounded-control border border-line bg-surface-2 p-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-0"
          />
          {error && <p className="text-xs text-warn">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onResolve(thread.id, thread.status === "open" ? "resolved" : "open")}
            >
              {thread.status === "open" ? "Resolve" : "Reopen"}
            </Button>
            <Button size="sm" onClick={reply} disabled={busy}>
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

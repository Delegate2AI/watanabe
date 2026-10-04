"use client";

import { useState } from "react";
import type { DocComment } from "@/lib/shared-docs/types";
import type { Person } from "@/lib/people/types";
import { PersonChip, personFor } from "@/components/person-chip";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

/**
 * The comments panel (spec 28), shown only to a comment/edit principal (the
 * server decides whether to render this at all). Lists the thread and, when
 * `canComment`, posts a new comment via POST /api/docs/[id]/comments.
 *
 * Author and time render through the shared renderers (surface-polish P-09): a
 * comment used to show a bare email and no date at all.
 */
export function CommentsPanel({
  id,
  initialComments,
  canComment,
  people = {},
}: {
  id: string;
  initialComments: DocComment[];
  canComment: boolean;
  /** Resolved server-side: <PersonChip> never resolves for itself. */
  people?: Record<string, Person>;
}) {
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setError("Could not add your comment.");
        return;
      }
      const listRes = await fetch(`/api/docs/${id}/comments`);
      if (listRes.ok) {
        const data = (await listRes.json()) as { comments: DocComment[] };
        setComments(data.comments);
      }
      setDraft("");
    } catch {
      setError("Could not add your comment.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-ink">Comments</h2>
      {comments.length === 0 ? (
        <p className="text-sm text-ink-muted">No comments yet.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-chip border border-line bg-surface-2 p-3 text-sm">
              <span className="flex items-baseline gap-2 text-xs text-ink-muted">
                <PersonChip person={personFor(people, c.authorEmail.trim().toLowerCase())} />
                <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)} className="ml-auto shrink-0 text-ink-faint">
                  {formatRelative(c.createdAt)}
                </time>
              </span>
              <span className="block text-ink">{c.body}</span>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment"
            className="min-h-[72px] w-full rounded-card border border-line bg-surface-2 p-3 text-sm text-ink"
          />
          {error && <p className="text-sm text-warn">{error}</p>}
          <div>
            <button
              type="button"
              onClick={submit}
              disabled={posting}
              className="rounded-chip bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {posting ? "Posting..." : "Comment"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import type { TaskComment } from "@/lib/db/task-comments";
import type { Person } from "@/lib/people/types";
import { PersonChip, personFor } from "@/components/person-chip";
import { mentionSegments } from "@/lib/shared-docs/mentions";
import { formatRelative } from "@/lib/ui/date";

/**
 * Discussion on a task (spec 2026-08-07). Flat and chronological, oldest first.
 *
 * `people` arrives already resolved: the resolver reads the directory from
 * disk, so it runs on the server and <PersonChip> only renders.
 *
 * Post, edit and delete all re-fetch the list rather than patching local state,
 * matching CommentsPanel (components/docs/comments-panel.tsx). A comment
 * someone else added between your page load and your post then appears too,
 * instead of being silently dropped by an optimistic splice.
 */

const PRIMARY_BTN =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50";
const LINK_BTN = "text-xs text-ink-muted hover:text-ink disabled:opacity-50";

function Body({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
      {mentionSegments(body).map((segment, index) =>
        segment.mention
          ? <span key={index} className="rounded bg-surface-2 px-1 font-medium text-ink">{segment.text}</span>
          : <span key={index}>{segment.text}</span>,
      )}
    </p>
  );
}

export function TaskComments({
  taskId,
  initialComments,
  viewerEmail,
  canModerate,
  people = {},
}: {
  taskId: string;
  initialComments: TaskComment[];
  viewerEmail: string;
  /** An administrator may delete anyone's comment. Never edit one. */
  canModerate: boolean;
  people?: Record<string, Person>;
}) {
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Never throws: a failed GET or a bad body is reported as `false` rather than
   * propagating, so `send()` below can tell "the write failed" apart from "the
   * write succeeded but the refresh did not" instead of a thrown reload error
   * being mistaken for a write failure.
   */
  async function reload(): Promise<boolean> {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`);
      if (!res.ok) return false;
      const data = (await res.json()) as { comments: TaskComment[] };
      setComments(data.comments);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Three outcomes, not two. "write-failed" means the POST/PATCH/DELETE itself
   * was rejected: nothing changed server-side, so the draft or edit box is kept
   * and `failure` is shown. "refresh-failed" means the write DID succeed but the
   * follow-up GET could not confirm it: the draft or edit box is still kept
   * (nothing to lose by keeping it, and clearing it would hide text the user
   * cannot tell was already saved), and a distinct message says so rather than
   * silently reporting success with a stale list, or wrongly reporting failure
   * on a write that went through.
   */
  async function send(
    url: string,
    init: RequestInit,
    failure: string,
  ): Promise<"ok" | "write-failed" | "refresh-failed"> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        setError(failure);
        return "write-failed";
      }
      const refreshed = await reload();
      if (!refreshed) {
        setError("Saved, but the list could not be refreshed.");
        return "refresh-failed";
      }
      return "ok";
    } catch {
      setError(failure);
      return "write-failed";
    } finally {
      setBusy(false);
    }
  }

  async function post(): Promise<void> {
    const body = draft.trim();
    if (!body) return;
    const outcome = await send(
      `/api/tasks/${taskId}/comments`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) },
      "Could not add your comment.",
    );
    if (outcome === "ok") setDraft("");
  }

  async function saveEdit(id: string): Promise<void> {
    const body = editDraft.trim();
    if (!body) return;
    const outcome = await send(
      `/api/tasks/${taskId}/comments/${id}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) },
      "Could not save your edit.",
    );
    if (outcome === "ok") setEditing(null);
  }

  async function remove(id: string): Promise<void> {
    await send(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" }, "Could not delete that comment.");
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-6">
      <h2 className="mb-4 text-sm font-medium text-ink">Discussion</h2>

      {comments.length === 0 ? (
        <p className="mb-4 text-sm text-ink-muted">No comments yet.</p>
      ) : (
        <ul className="mb-6 space-y-5">
          {comments.map((comment) => {
            const mine = comment.authorEmail === viewerEmail;
            return (
              <li key={comment.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <PersonChip person={personFor(people, comment.authorEmail)} variant="avatar" />
                  <span className="text-xs text-ink-muted">{formatRelative(comment.createdAt)}</span>
                  {comment.editedAt ? <span className="text-xs text-ink-muted">(edited)</span> : null}
                  <span className="grow" />
                  {mine ? (
                    <button
                      type="button"
                      className={LINK_BTN}
                      disabled={busy}
                      onClick={() => { setEditing(comment.id); setEditDraft(comment.body); }}
                    >
                      Edit
                    </button>
                  ) : null}
                  {mine || canModerate ? (
                    <button type="button" className={LINK_BTN} disabled={busy} onClick={() => remove(comment.id)}>
                      Delete
                    </button>
                  ) : null}
                </div>
                {editing === comment.id ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full rounded-md border border-line bg-surface-2 p-2 text-sm text-ink"
                      rows={3}
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <button type="button" className={PRIMARY_BTN} disabled={busy} onClick={() => saveEdit(comment.id)}>
                        Save
                      </button>
                      <button type="button" className={LINK_BTN} disabled={busy} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <Body body={comment.body} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <textarea
        className="w-full rounded-md border border-line bg-surface-2 p-2 text-sm text-ink"
        rows={3}
        placeholder="Write a comment..."
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className={PRIMARY_BTN} disabled={busy || draft.trim() === ""} onClick={post}>
          Post
        </button>
        {error ? <span role="alert" className="text-sm text-warn">{error}</span> : null}
      </div>
    </section>
  );
}

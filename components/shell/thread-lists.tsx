"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ThreadRow } from "./thread-row";
import { ListSkeleton } from "@/components/skeletons/list-skeleton";
import { notifyFailure } from "@/lib/ui/toast";
import { onThreadsChanged } from "@/lib/chat/threads-changed";
import type { ThreadSummary } from "@/lib/threads/summaries";

/** Identity of a rendered list, for spotting a server list we have not adopted. */
function signature(threads: ThreadSummary[]): string {
  return threads.map((t) => `${t.id}:${t.pinned ? 1 : 0}:${t.title}`).join("\u0000");
}

/**
 * The sidebar's live Pinned + Recents groups (spec 24), replacing the spec-18
 * stub data. Splits the caller's own threads on the `pinned` flag. Each row can
 * be pinned, renamed, or deleted through its kebab menu, wired to
 * `PATCH`/`DELETE /api/threads/[id]`. Mutations update optimistically and, on a
 * failed write, resync from the server so the sidebar never lies.
 *
 * `initialThreads` is the shell layout's server-rendered list (the same
 * owner-scoped read `GET /api/threads` performs, run during the page's own
 * request). When it is present the sidebar arrives populated and the mount fetch
 * is skipped: the list used to hydrate empty, show placeholder rows, and only
 * then round-trip for data the server already had in hand. A later server render
 * (any `router.refresh()`) hands down a fresh list, and the render-time check
 * below adopts it, so the sidebar tracks the server without an effect.
 *
 * Absent the prop it keeps the original behaviour and fetches on mount, so any
 * caller that cannot resolve the list server-side still works, and degrades
 * quietly: a failed fetch simply renders empty groups.
 */
export function ThreadLists({
  onNavigate,
  initialThreads,
}: {
  onNavigate?: () => void;
  initialThreads?: ThreadSummary[];
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads ?? []);
  // An unloaded list is not an empty list. Until the request settles the group
  // renders placeholder rows, so a returning user is not shown what looks like
  // a chat history they never had. Server-seeded, there is nothing to wait for.
  const [loading, setLoading] = useState(initialThreads === undefined);

  // Adopting the newest server list during render, not in an effect: an effect
  // would paint the stale list first and correct it a frame later. The prop is a
  // new array on every server render, so the comparison is on content.
  const serverSignature = initialThreads ? signature(initialThreads) : null;
  const [adopted, setAdopted] = useState(serverSignature);
  if (initialThreads && serverSignature !== adopted) {
    setAdopted(serverSignature);
    setThreads(initialThreads);
  }

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (!res.ok) return;
      const body = (await res.json()) as { threads?: ThreadSummary[] };
      if (Array.isArray(body.threads)) setThreads(body.threads);
    } catch {
      /* leave the lists as-is on a transient failure */
    } finally {
      setLoading(false);
    }
  }, []);

  // A chat started from Home creates its thread mid-stream, without any
  // navigation to re-render the shell that lists it (see
  // lib/chat/threads-changed.ts), so the sidebar has to be told. Refetching is
  // cheap and owner-scoped, and `refresh` already tolerates a transient failure.
  useEffect(() => onThreadsChanged(() => void refresh()), [refresh]);

  // Only when the server did not already provide the list. Depends on the
  // boolean, never on the array: the prop is a fresh array on every render and
  // would re-run this on every one of them.
  const serverSeeded = initialThreads !== undefined;
  useEffect(() => {
    if (serverSeeded) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/threads");
        if (!res.ok) return;
        const body = (await res.json()) as { threads?: ThreadSummary[] };
        if (!cancelled && Array.isArray(body.threads)) setThreads(body.threads);
      } catch {
        /* leave the lists empty on a transient failure */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverSeeded]);

  // Optimistic mutation, best-effort persistence: the sidebar reflects the
  // change instantly, and a failed write resyncs from the server (and says so)
  // rather than leaving the row in a lie.
  const persist = useCallback(
    async (id: string, init: RequestInit, failure: string) => {
      try {
        const res = await fetch(`/api/threads/${id}`, init);
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        notifyFailure(failure);
        void refresh();
      }
    },
    [refresh],
  );

  const pin = useCallback(
    (id: string, pinned: boolean) => {
      setThreads((current) => current.map((t) => (t.id === id ? { ...t, pinned } : t)));
      void persist(
        id,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned }) },
        "Could not update the chat.",
      );
    },
    [persist],
  );

  const rename = useCallback(
    (id: string, title: string) => {
      setThreads((current) => current.map((t) => (t.id === id ? { ...t, title } : t)));
      void persist(
        id,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) },
        "Could not rename the chat.",
      );
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      setThreads((current) => current.filter((t) => t.id !== id));
      void persist(id, { method: "DELETE" }, "Could not delete the chat.");
    },
    [persist],
  );

  const pinned = threads.filter((t) => t.pinned);
  const recents = threads.filter((t) => !t.pinned);

  const handlers = { onNavigate, onPin: pin, onRename: rename, onDelete: remove };

  return (
    <>
      {pinned.length > 0 && <ThreadGroup label="Pinned" threads={pinned} {...handlers} />}
      <ThreadGroup label="Recents" threads={recents} viewAll loading={loading} {...handlers} />
    </>
  );
}

function ThreadGroup({
  label,
  threads,
  onNavigate,
  onPin,
  onRename,
  onDelete,
  viewAll,
  loading = false,
}: {
  label: string;
  threads: ThreadSummary[];
  onNavigate?: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  viewAll?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="mb-3.5">
      <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      {loading && <ListSkeleton rows={4} label="Loading recent chats" />}
      {!loading &&
        threads.map((t) => (
          <ThreadRow
            key={t.id}
            title={t.title}
            href={`/chat/${t.id}`}
            pinned={t.pinned}
            onNavigate={onNavigate}
            onPin={(pinned) => onPin(t.id, pinned)}
            onRename={(title) => onRename(t.id, title)}
            onDelete={() => onDelete(t.id)}
          />
        ))}
      {viewAll && !loading && (
        <Link
          href="/chat"
          onClick={onNavigate}
          className="block px-2.5 py-1.5 text-xs text-ink-faint hover:text-accent"
        >
          View all
        </Link>
      )}
    </div>
  );
}

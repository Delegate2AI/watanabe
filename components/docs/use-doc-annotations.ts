"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { messageForBody, codeFromBody } from "@/lib/errors/messages";
import type { CommentThread, Suggestion, TextAnchor } from "@/lib/shared-docs/types";

/**
 * Data layer for the annotated reading surface (spec 2026-07-22): thread and
 * suggestion state, the ~10s visibility-gated poll, and every fetch handler.
 * Split out of `annotated-doc.tsx` (the presentational shell) to keep that
 * file under the file-size hook's line budget.
 */
export function useDocAnnotations(docId: string, initialThreads: CommentThread[], initialSuggestions: Suggestion[]) {
  const router = useRouter();
  const [threads, setThreads] = useState(initialThreads);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  // Every mutation below used to end in `if (!res.ok) return`, which made a
  // rejected request indistinguishable from a click that never registered.
  const [error, setError] = useState<string | null>(null);

  /** Read the error body once, for the message and for the code behind it. */
  async function failure(res: Response): Promise<{ message: string; code?: string }> {
    const body = await res.json().catch(() => null);
    return { message: messageForBody(body), code: codeFromBody(body) };
  }

  // Promise.allSettled (not Promise.all): one endpoint rejecting must not
  // discard the other's successful result. Each fetch is applied independently,
  // only when it both fulfilled and returned ok.
  const refresh = useCallback(async () => {
    const [tResult, sResult] = await Promise.allSettled([
      fetch(`/api/docs/${docId}/comments`),
      fetch(`/api/docs/${docId}/suggestions`),
    ]);
    if (tResult.status === "fulfilled" && tResult.value.ok) {
      const d = (await tResult.value.json()) as { threads?: CommentThread[] };
      if (d.threads) setThreads(d.threads);
    }
    if (sResult.status === "fulfilled" && sResult.value.ok) {
      const d = (await sResult.value.json()) as { suggestions?: Suggestion[] };
      if (d.suggestions) setSuggestions(d.suggestions);
    }
  }, [docId]);

  // Poll while the tab is visible (spec: ~10s, no sockets). Wrapped in its own
  // try/catch so a transient network rejection inside `refresh` cannot become
  // an unhandled promise rejection: `setInterval` never awaits its callback.
  const poll = useCallback(async () => {
    try {
      await refresh();
    } catch {
      // Transient failure; the next poll tick retries.
    }
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(poll, 10_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll]);

  async function submitComment(body: string, anchor: TextAnchor | null): Promise<boolean> {
    const res = await fetch(`/api/docs/${docId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, anchor: anchor ?? undefined }),
    });
    if (!res.ok) {
      setError((await failure(res)).message);
      return false;
    }
    setError(null);
    await refresh();
    return true;
  }

  async function submitSuggestion(anchor: TextAnchor, proposedText: string, note: string): Promise<boolean> {
    // originalText is never sent: the server derives it from the anchor's own
    // quote, so a comment-only caller cannot make the review card describe a
    // different target than what Accept will locate and splice.
    const res = await fetch(`/api/docs/${docId}/suggestions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anchor, proposedText, note: note.trim() || undefined }),
    });
    if (!res.ok) {
      setError((await failure(res)).message);
      return false;
    }
    setError(null);
    await refresh();
    return true;
  }

  // Throws on a failed reply so the caller (CommentThreadCard) can keep the
  // user's draft and show an error instead of clearing it as if it had sent.
  async function onReply(threadId: string, body: string): Promise<void> {
    const res = await fetch(`/api/docs/${docId}/comments/${threadId}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error("failed to post reply");
    await refresh();
  }

  async function onResolve(threadId: string, status: "open" | "resolved"): Promise<void> {
    const res = await fetch(`/api/docs/${docId}/comments/${threadId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError((await failure(res)).message);
      return;
    }
    setError(null);
    await refresh();
  }

  async function onAccept(sid: string): Promise<void> {
    const res = await fetch(`/api/docs/${docId}/suggestions/${sid}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept" }),
    });
    if (!res.ok) {
      const { message, code } = await failure(res);
      // A 409 here is the route having marked the suggestion `stale` on its way
      // out, so retrying can never work and "reload and try again" is the wrong
      // advice. Refresh regardless: the server state moved, and the card that
      // still shows Accept is now describing a decision that cannot be made.
      setError(
        code === "conflict"
          ? "That edit could not be applied: the text it targets has changed. Apply it by hand."
          : message,
      );
      await refresh();
      return;
    }
    setError(null);
    await refresh();
    router.refresh(); // re-fetch the server-rendered body after a splice
  }

  async function onReject(sid: string): Promise<void> {
    const res = await fetch(`/api/docs/${docId}/suggestions/${sid}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reject" }),
    });
    if (!res.ok) {
      setError((await failure(res)).message);
      await refresh();
      return;
    }
    setError(null);
    await refresh();
  }

  return {
    threads, suggestions, error, refresh,
    submitComment, submitSuggestion, onReply, onResolve, onAccept, onReject,
  };
}

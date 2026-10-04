"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { useRouter } from "next/navigation";
import type { Turn } from "@/lib/agent/conversation";
import type { ContextUsage } from "@/lib/agent/events";
import type { useChatContext } from "./chat-context-provider";
import { STORAGE_KEY, type AgentSessionInfo } from "./chat-types";

/** `ChatContextValue | null` — derived rather than imported, since chat-context-provider.tsx keeps the interface private. */
type ChatCtx = ReturnType<typeof useChatContext>;

/**
 * Session identity and its server-backed state: which chat we're in, the list
 * of past chats, the context meter, the staged-draft view, and the spec 15 D34
 * reattach poller.
 *
 * Extracted verbatim from `agent-chat.tsx`. `setTurns`/`setBusy` stay owned by
 * `useAgentChat` (the streaming layer) and are passed in, because both layers
 * write them: a restored session replaces the transcript, and the poller drives
 * `busy` for a turn it did not start.
 */
export function useChatSession({
  setTurns,
  setBusy,
  chatCtx,
  router,
}: {
  setTurns: (turns: Turn[]) => void;
  setBusy: (busy: boolean) => void;
  chatCtx: ChatCtx;
  router: ReturnType<typeof useRouter>;
}) {
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const setSession = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setCurrentId(id);
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/sessions");
      if (!res.ok) return;
      const body = (await res.json()) as { sessions?: AgentSessionInfo[] };
      setSessions(body.sessions ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const refreshContext = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) {
      setContextUsage(null);
      return;
    }
    try {
      const res = await fetch(`/api/agent/context?id=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { usage: ContextUsage | null };
      setContextUsage(body.usage ?? null);
    } catch {
      /* non-fatal */
    }
  }, []);

  // The chat's own live view of its session's staged draft (spec 12 D26) —
  // independent of the vault page's server-rendered draft data, this is what
  // lets `DraftBanner` show up on the PUBLISHED view (no `?draft=` at all)
  // once something gets staged, without a reload. `chatCtx` is `null` outside
  // a `ChatContextProvider` (e.g. `/chat`, `/embed`), so this is a no-op there.
  const refreshDraftState = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id || !chatCtx) return;
    try {
      const res = await fetch(`/api/agent/draft?sessionId=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { exists: boolean; changedFiles?: { path: string }[] };
      chatCtx.setDraftState(
        body.exists ? { sessionId: id, changedFileCount: body.changedFiles?.length ?? 0 } : null,
      );
    } catch {
      /* non-fatal, same posture as refreshContext/refreshSessions */
    }
  }, [chatCtx]);

  // Reattach-by-polling (spec 15 D34): when a restored session reports a turn
  // still in flight (`active: true` — e.g. the user hard-refreshed mid-turn,
  // losing the NDJSON stream), keep re-reading the transcript until the turn
  // lands. Coarser than streaming (turns appear as the SDK flushes them) but
  // this is a recovery path; the composer stays busy meanwhile — a concurrent
  // POST into the same session would orphan the queued reply — and Stop keeps
  // working via /api/agent/interrupt.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setBusy(true);
      const startedAt = Date.now();
      pollTimerRef.current = setInterval(async () => {
        // The user switched chats or started something new — this poll is moot.
        if (sessionIdRef.current !== id) return stopPolling();
        if (Date.now() - startedAt > 10 * 60_000) {
          stopPolling();
          setBusy(false);
          return;
        }
        try {
          const res = await fetch(`/api/agent/sessions?id=${encodeURIComponent(id)}`);
          if (res.status === 403 || res.status === 404) {
            stopPolling();
            setBusy(false);
            setSession(null);
            setTurns([]);
            return;
          }
          if (!res.ok) return; // transient — next tick retries
          const body = (await res.json()) as { turns?: Turn[]; active?: boolean };
          if (sessionIdRef.current !== id) return stopPolling();
          setTurns(body.turns ?? []);
          if (!body.active) {
            stopPolling();
            setBusy(false);
            void refreshSessions();
            void refreshContext();
            void refreshDraftState();
            // Files may have been staged during the blind window — re-render
            // the server-side vault view once, same as a live turn's flush.
            router.refresh();
          }
        } catch {
          /* transient — next tick retries */
        }
      }, 2500);
    },
    [stopPolling, setSession, setBusy, setTurns, refreshSessions, refreshContext, refreshDraftState, router],
  );

  const loadSession = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/agent/sessions?id=${encodeURIComponent(id)}`);
        // Only a DEFINITIVE server verdict drops the stored id: 403 (not ours)
        // or 404 (gone — empty AND cold AND absent from the on-disk store, see
        // the sessions route, spec 15 D32). A 200 with empty turns is a healthy
        // session whose first turn just hasn't flushed yet — adopting it is the
        // whole point; the old client-side "empty means stale" guess wiped
        // in-flight sessions. Any other failure is transient: keep the id.
        if (res.status === 403 || res.status === 404) {
          setSession(null);
          setTurns([]);
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { turns?: Turn[]; active?: boolean };
        setTurns(body.turns ?? []);
        sessionIdRef.current = id;
        setCurrentId(id);
        if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
        if (body.active) startPolling(id); // reattach to the in-flight turn (spec 15 D34)
        void refreshContext();
        void refreshDraftState(); // mount-time restore trigger (spec 12 D26)
      } catch {
        /* non-fatal */
      }
    },
    [refreshContext, refreshDraftState, setSession, setTurns, startPolling],
  );

  // On mount: load this agent's past chats and restore the last one, if any.
  // Deferred one microtask out so the effect callback itself never directly
  // closes over a setState setter (avoids react-hooks/set-state-in-effect —
  // this is a one-shot "sync with an external system" fetch, not a
  // render-derived state update).
  useEffect(() => {
    queueMicrotask(() => {
      void refreshSessions();
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (saved) void loadSession(saved);
    });
  }, [refreshSessions, loadSession]);

  return {
    sessions,
    currentId,
    contextUsage,
    setContextUsage,
    sessionIdRef,
    setSession,
    refreshSessions,
    refreshContext,
    refreshDraftState,
    loadSession,
    stopPolling,
  };
}

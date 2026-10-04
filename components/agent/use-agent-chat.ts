"use client";

import { useCallback, useEffect, useState } from "react";
import type { Turn } from "@/lib/agent/conversation";
import type { PermissionDecision } from "@/lib/agent/events";
import type { PendingPermission } from "./permission-modal";
import type { AgentStarter } from "./agent-starters";
import { useChatContext } from "./chat-context-provider";
import { useChatSession } from "./use-chat-session";
import { useChatScroll } from "./use-chat-scroll";
import { useRouterRefresh } from "./use-router-refresh";
import { useTurnStream } from "./use-turn-stream";

/**
 * All of `AgentChat`'s behaviour, composed from four single-concern hooks:
 * `useRouterRefresh` (spec 15 D33), `useChatSession` (identity, persistence,
 * D34 reattach polling), `useChatScroll` (follow-the-bottom), and
 * `useTurnStream` (the NDJSON turn loop). The transcript itself and the
 * composer's remaining actions live here, since every layer touches them.
 */
export function useAgentChat({ pageContext }: { pageContext?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [endingSession, setEndingSession] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);

  const { router, scheduleRouterRefresh, flushRouterRefresh } = useRouterRefresh();

  // Selection→chat pending chips (spec 11) — null outside a ChatContextProvider
  // (e.g. /chat, /embed — not wrapped yet, see spec 11 Phase B); every use
  // below degrades to "no chips attached" rather than erroring.
  const chatCtx = useChatContext();

  // The selection toolbar sits outside this component's own tree (mounted in
  // VaultMarkdown, inside <main>) but still needs to prefill the composer the
  // same way a starter card does — bridge its prefill request into this
  // component's own local `prefill` state on every new request. Deferred one
  // microtask out, same as the on-mount session-restore effect below, so the
  // effect callback itself never directly closes over a setState setter
  // (avoids react-hooks/set-state-in-effect).
  useEffect(() => {
    const request = chatCtx?.prefillRequest;
    if (!request) return;
    queueMicrotask(() => setPrefill(request));
  }, [chatCtx?.prefillRequest]);

  const pickStarter = useCallback((s: AgentStarter) => {
    setPrefill((p) => ({ text: s.prompt, nonce: (p?.nonce ?? 0) + 1 }));
  }, []);

  // The current page's title: the prop path serves /embed (`?page=`, resolved
  // server-side per request); the provider path serves the vault, where this
  // component now outlives any single page (spec 15 D29/D30) and the pages
  // report their titles in via ChatPageContext as the user navigates.
  const effectivePageContext = pageContext ?? chatCtx?.pageTitle ?? undefined;

  const session = useChatSession({ setTurns, setBusy, chatCtx, router });

  // The "agent is working" indicator (spec 15 D35). Visible whenever a turn
  // is in flight but the transcript has no streaming content to show for it:
  // right after send (the SDK subprocess takes seconds to produce the first
  // event — previously just a near-invisible cursor), and during D34
  // reattach-polling (where the disk transcript has no streaming turn at
  // all). Once real content streams in, the content itself is the indicator.
  //
  // Derived before `useChatScroll` because it renders inside the scroll
  // container: its appearance grows the content and must re-pin the view.
  const lastTurn = turns[turns.length - 1];
  const streamingContentVisible =
    lastTurn?.role === "assistant" && lastTurn.status === "streaming" && lastTurn.segments.length > 0;
  const showThinking = busy && !streamingContentVisible;

  const scroll = useChatScroll(turns, showThinking);

  const { send } = useTurnStream({
    setTurns,
    setBusy,
    setPending,
    setStatusText,
    setSessionCost,
    sessionIdRef: session.sessionIdRef,
    setSession: session.setSession,
    refreshContext: session.refreshContext,
    refreshDraftState: session.refreshDraftState,
    refreshSessions: session.refreshSessions,
    scheduleRouterRefresh,
    flushRouterRefresh,
    stopPolling: session.stopPolling,
    pinToBottom: scroll.pinToBottom,
    chatCtx,
  });

  const { sessionIdRef, setSession, setContextUsage, loadSession } = session;

  const newChat = useCallback(() => {
    if (busy) return;
    setTurns([]);
    setSessionCost(0);
    setContextUsage(null);
    setSession(null);
  }, [busy, setSession, setContextUsage]);

  const switchTo = useCallback(
    (id: string) => {
      if (busy || !id) return;
      setSessionCost(0);
      setContextUsage(null);
      void loadSession(id);
    },
    [busy, loadSession, setContextUsage],
  );

  const stop = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await fetch("/api/agent/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
    } catch {
      /* ignore */
    }
  }, [sessionIdRef]);

  // Explicit "end and save": lets a contributor ask the memory subsystem
  // (lib/memory/dream.ts, via POST /api/agent/memory/end) to consolidate
  // this thread right now instead of waiting on the idle/eviction/backstop
  // triggers. Mirrors the stop()/decide() fetch idiom above, posting the
  // same `{ sessionId }` shape those already send.
  const endSession = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    setEndingSession(true);
    try {
      const res = await fetch("/api/agent/memory/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const { status } = (await res.json()) as { status: string };
      if (status === "committed") setMemoryNotice("Saved to memory");
      else if (status === "nothing") setMemoryNotice("Nothing new to save");
      else if (status === "skipped") setMemoryNotice(null);
      else setMemoryNotice("Could not save to memory");
    } catch {
      setMemoryNotice("Could not save to memory");
    } finally {
      setEndingSession(false);
    }
  }, [sessionIdRef]);

  // Resolve a confirmation emitted by the tool gate. The permission route
  // applies the decision to the matching live session request.
  const decide = useCallback(
    async (requestId: string, decision: PermissionDecision) => {
      setPending(null);
      if (!sessionIdRef.current) return;
      try {
        await fetch("/api/agent/permission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current, requestId, decision }),
        });
      } catch {
        /* the turn stream will surface any resulting error */
      }
    },
    [sessionIdRef],
  );

  return {
    turns,
    busy,
    sessionCost,
    prefill,
    pending,
    statusText,
    endingSession,
    memoryNotice,
    showThinking,
    effectivePageContext,
    chatCtx,
    sessions: session.sessions,
    currentId: session.currentId,
    contextUsage: session.contextUsage,
    scroll,
    pickStarter,
    send,
    newChat,
    switchTo,
    stop,
    endSession,
    decide,
  };
}

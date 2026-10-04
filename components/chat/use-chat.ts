"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readNdjson } from "@/lib/agent/stream-client";
import type { AssistantTurn, Turn } from "@/lib/agent/conversation";
import type { AgentEvent } from "@/lib/agent/events";
import type { MessageContext } from "@/lib/agent/context";
import { activeDocId } from "@/lib/canvas/derive";
import { messageForBody } from "@/lib/errors/messages";
import { consumePendingConnectors } from "./connector-param";
import { useTurnPatch } from "./use-turn-patch";
import {
  delay,
  localId,
  MAX_RECONNECT_POLLS,
  RECONNECT_POLL_MS,
  type ChatStatus,
  type ThreadDocSummary,
  type UseChatOptions,
} from "./use-chat-types";
export type { ChatStatus, ThreadDocSummary, UseChatOptions } from "./use-chat-types";

/**
 * The spec-24 chat runtime hook: the new chat UI's bridge to the existing agent
 * transport (`POST /api/agent` NDJSON, `/api/agent/interrupt`,
 * `/api/agent/sessions` for transcript hydration + reconnect). Reuses
 * `readNdjson` and the `applyEvent` reducer so both chat surfaces share one wire
 * contract.
 *
 * `activeId` is the LIVE SDK session id as React state: null for a new thread
 * until the stream reports it, then the real id. Callers pass `activeId` (never
 * the route's placeholder) to every thread-scoped control, so a new chat's model
 * PATCH / attachment upload target the real, owned thread rather than an orphan.
 */
export function useChat(threadId?: string, options: UseChatOptions = {}) {
  const { isNew = false, preMinted = false, onSession, canvasEnabled = false, docId, pendingConnectors, modelChoice } = options;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const resumeMode = Boolean(threadId) && !isNew;
  const adopted = Boolean(threadId) && isNew && preMinted;
  const [activeId, setActiveId] = useState<string | null>(resumeMode || adopted ? threadId! : null);
  const sessionIdRef = useRef<string | null>(resumeMode || adopted ? threadId! : null);
  const hydratedRef = useRef(resumeMode || adopted);
  const adoptedFirstSendRef = useRef(adopted);
  const abortRef = useRef<AbortController | null>(null);
  const pendingConnectorsRef = useRef<readonly string[] | undefined>(pendingConnectors);
  const interruptedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Deliberately do NOT abort the in-flight turn here. React's dev Strict
      // Mode mounts→unmounts→mounts a component once, firing this cleanup on the
      // synthetic unmount. A new chat seeds its first (and, by the seed guard,
      // ONLY) send from a mount effect, so aborting here killed that send: the
      // server keeps the session warm on disconnect and finishes the turn (its
      // answer then surfaces as a SEPARATE thread), while this tab hangs on
      // "Working" forever with the URL stuck at the never-persisted client id
      // (404 on reload). The stream self-terminates on turn_result, and a real
      // navigation away just lets the started turn finish in the background.
      // Explicit aborts still happen on user interrupt and on the next send.
    };
  }, []);

  const setSession = useCallback(
    (id: string) => {
      sessionIdRef.current = id;
      hydratedRef.current = true;
      setActiveId(id);
      onSession?.(id);
    },
    [onSession],
  );

  // True from mount until the transcript request settles, on a resume only. It
  // is the difference between "this thread is empty" and "this thread has not
  // arrived yet": without it the transcript renders its empty state for the two
  // to three seconds the fetch takes, asserting a thread with content is empty.
  // A new thread has nothing to hydrate, so it never enters this state.
  const [hydrating, setHydrating] = useState(resumeMode);

  // Hydrate an existing thread's transcript on mount (resume only; a new thread
  // has nothing to hydrate). This is also the reconnect entry point's sibling.
  useEffect(() => {
    if (!resumeMode || !threadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/agent/sessions?id=${encodeURIComponent(threadId)}`);
        if (!res.ok) return; // keep the id (server said we own it); a transient miss must not wipe it
        const body = (await res.json()) as { turns?: Turn[] };
        if (!cancelled && Array.isArray(body.turns) && body.turns.length > 0) setTurns(body.turns);
      } catch {
        // Transient network error: leave the id intact so send() resumes it.
      } finally {
        // Settled either way. A failed hydrate must not leave the surface
        // loading forever, so the empty state becomes truthful again.
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeMode, threadId]);

  // Spec 29 resume hydration: fetch the thread's chat documents so their cards
  // reappear on reload. Gated on canvasEnabled + resume, and the setState is
  // after the awaited fetch (never synchronous in the effect body).
  const [threadDocs, setThreadDocs] = useState<ThreadDocSummary[]>([]);
  useEffect(() => {
    if (!canvasEnabled || !resumeMode || !threadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/chat-docs?thread=${encodeURIComponent(threadId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { docs?: ThreadDocSummary[] };
        if (!cancelled && Array.isArray(body.docs)) setThreadDocs(body.docs);
      } catch {
        /* transient: cards still hydrate from the transcript's tool results */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasEnabled, resumeMode, threadId]);

  // Frame-coalesced: token deltas batch into one transcript update per frame and
  // everything else applies immediately. See use-turn-patch.ts for why.
  const { patch, flush } = useTurnPatch(setTurns);

  /**
   * Reconnect after a dropped stream (spec 24): re-request the owner-scoped
   * transcript and resume rendering, polling while the run is still active,
   * per the spec-15 persistence/live-sync contract. Falls back to an error
   * bubble only if the transcript itself cannot be read.
   */
  const reconnect = useCallback(async (assistantId: string) => {
    const id = sessionIdRef.current;
    if (!id) {
      patch(assistantId, { type: "error", message: "connection lost" });
      return;
    }
    for (let i = 0; i < MAX_RECONNECT_POLLS; i++) {
      if (!mountedRef.current || interruptedRef.current) return;
      let res: Response;
      try {
        res = await fetch(`/api/agent/sessions?id=${encodeURIComponent(id)}`);
      } catch {
        patch(assistantId, { type: "error", message: "reconnect failed" });
        return;
      }
      if (!res.ok) {
        patch(assistantId, { type: "error", message: "reconnect failed" });
        return;
      }
      const body = (await res.json().catch(() => null)) as { turns?: Turn[]; active?: boolean } | null;
      if (body && Array.isArray(body.turns) && body.turns.length > 0) setTurns(body.turns);
      if (!body?.active) return; // run finished; the rehydrated transcript is final
      await delay(RECONNECT_POLL_MS);
    }
  }, [patch]);

  const send = useCallback(
    async (input: string, context: MessageContext[] = []) => {
      const text = input.trim();
      if (!text) return;
      interruptedRef.current = false;
      const assistantId = localId();
      const userTurn: Turn = { id: localId(), role: "user", content: text };
      const assistantTurn: AssistantTurn = { id: assistantId, role: "assistant", segments: [], status: "streaming" };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setStatus("streaming");

      const controller = new AbortController();
      abortRef.current = controller;
      const resumeId = hydratedRef.current ? sessionIdRef.current ?? undefined : undefined;
      const untouched = adoptedFirstSendRef.current;
      const connectors = consumePendingConnectors(pendingConnectorsRef, Boolean(resumeId) && !untouched);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: resumeId,
            message: text,
            context: context.length > 0 ? context : undefined,
            docId,
            ...(resumeId && !untouched ? {} : (modelChoice ?? {})),
            connectors: connectors && connectors.length > 0 ? connectors : undefined,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as unknown;
          if (res.status === 403) {
            sessionIdRef.current = null;
            hydratedRef.current = false;
            setActiveId(null);
          }
          throw new Error(messageForBody(body));
        }
        for await (const event of readNdjson<AgentEvent>(res.body)) {
          if (event.type === "session") {
            setSession(event.sessionId);
            continue;
          }
          if (event.type === "turn_result" && event.ok) adoptedFirstSendRef.current = false;
          patch(assistantId, event);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // A user interrupt: leave the turn as-is (interrupt() handled status).
        } else if (!interruptedRef.current && sessionIdRef.current) {
          // A dropped stream (not a user interrupt) with a known session: try to
          // rehydrate from the transcript instead of painting an error.
          await reconnect(assistantId);
        } else {
          patch(assistantId, { type: "error", message: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        // The stream is over, so nothing else will arrive to trigger the next
        // frame: whatever text is still queued has to land now, whether the turn
        // ended, errored, or was interrupted mid-sentence.
        flush();
        if (abortRef.current === controller) abortRef.current = null;
        setStatus("idle");
      }
    },
    [flush, patch, reconnect, setSession, docId, modelChoice],
  );

  // Spec 29 "active doc" signal: the docId of the most recent doc_write across
  // the transcript, derived purely from the streamed tool events. Null until the
  // agent writes a document (so it is inert when the canvas is off). Consumers
  // use it to open/update the pane; it never affects the wire contract.
  const activeDoc = useMemo(() => activeDocId(turns), [turns]);

  const interrupt = useCallback(async () => {
    const id = sessionIdRef.current;
    interruptedRef.current = true;
    abortRef.current?.abort();
    setStatus("idle");
    if (!id) return;
    try {
      await fetch("/api/agent/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
    } catch {
      /* best-effort; the reader is already aborted */
    }
  }, []);

  return { turns, send, interrupt, status, hydrating, activeId, activeDoc, threadDocs };
}

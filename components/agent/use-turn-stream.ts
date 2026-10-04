"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { readNdjson } from "@/lib/agent/stream-client";
import type { AssistantTurn, Turn } from "@/lib/agent/conversation";
import type { AgentEvent } from "@/lib/agent/events";
import { useTurnPatch } from "@/components/chat/use-turn-patch";
import type { MessageContext } from "@/lib/agent/context";
import type { PendingPermission } from "./permission-modal";
import type { useChatContext } from "./chat-context-provider";
import { DRAFT_MUTATING_TOOLS, toDisplayChip, uid } from "./chat-types";
import { messageForBody } from "@/lib/errors/messages";

type ChatCtx = ReturnType<typeof useChatContext>;

/**
 * The NDJSON turn loop: POST a message, fold every streamed event into the
 * in-flight assistant turn, and fan the side effects (draft refresh, vault
 * re-render, context meter) out to the collaborators passed in.
 *
 * Extracted verbatim from `agent-chat.tsx`. Everything it writes is owned
 * elsewhere — `useAgentChat` holds the transcript state, `useChatSession` the
 * session identity — so all of it arrives as parameters rather than being
 * re-declared here.
 */
export function useTurnStream({
  setTurns,
  setBusy,
  setPending,
  setStatusText,
  setSessionCost,
  sessionIdRef,
  setSession,
  refreshContext,
  refreshDraftState,
  refreshSessions,
  scheduleRouterRefresh,
  flushRouterRefresh,
  stopPolling,
  pinToBottom,
  chatCtx,
}: {
  setTurns: Dispatch<SetStateAction<Turn[]>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setPending: Dispatch<SetStateAction<PendingPermission | null>>;
  setStatusText: Dispatch<SetStateAction<string | null>>;
  setSessionCost: Dispatch<SetStateAction<number>>;
  sessionIdRef: React.RefObject<string | null>;
  setSession: (id: string | null) => void;
  refreshContext: () => Promise<void>;
  refreshDraftState: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  scheduleRouterRefresh: () => void;
  flushRouterRefresh: () => void;
  stopPolling: () => void;
  pinToBottom: () => void;
  chatCtx: ChatCtx;
}) {
  // The in-flight turn's fetch (spec 15 D31) — aborted on unmount so a
  // genuine exit from the chat's surface (vault → /chat, tab close) doesn't
  // leave a zombie reader pumping events into a dead component. Ordinary
  // vault navigation no longer unmounts this component at all (spec 15 D29).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Frame-coalesced, same as the spec-24 chat surface: token deltas batch into
  // one transcript update per frame, everything else applies immediately. See
  // components/chat/use-turn-patch.ts.
  const { patch: patchAssistant, flush: flushPatches } = useTurnPatch(setTurns);

  const send = useCallback(
    async (text: string, context: MessageContext[] = []) => {
      const assistantId = uid();
      const assistantTurn: AssistantTurn = {
        id: assistantId,
        role: "assistant",
        segments: [],
        status: "streaming",
      };
      const userTurn: Turn = {
        id: uid(),
        role: "user",
        content: text,
        context: context.length > 0 ? context.map(toDisplayChip) : undefined,
      };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      stopPolling(); // a live stream supersedes any reattach polling (spec 15 D34)
      setBusy(true);
      pinToBottom();
      // Optimistic, same contract as the composer's own text field: the
      // chips just got attached to the turn above, so clear the pending row
      // now rather than waiting on the request to resolve.
      chatCtx?.clearChips();

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current ?? undefined,
            message: text,
            context: context.length > 0 ? context : undefined,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as unknown;
          // A 403 means the stored session id isn't (or is no longer) ours —
          // e.g. a leftover id from a different signed-in user on this
          // browser. Drop it so the NEXT message starts a fresh thread
          // instead of retrying the same forbidden id forever.
          if (res.status === 403) setSession(null);
          throw new Error(messageForBody(body));
        }

        // Correlates a tool_result back to the tool_use that started it (the
        // wire protocol carries the tool NAME only on tool_use, not on its
        // matching tool_result — see lib/agent/events.ts) — scoped to this
        // one turn, just to detect a successful staging/discard/submit call
        // for the live draft-state refresh below (spec 12 D26).
        const toolNameById = new Map<string, string>();

        for await (const event of readNdjson<AgentEvent>(res.body)) {
          switch (event.type) {
            case "session":
              setSession(event.sessionId);
              break;
            case "status":
              setStatusText(event.text);
              break;
            case "tool_use":
              toolNameById.set(event.id, event.name);
              patchAssistant(assistantId, event);
              break;
            case "tool_result": {
              const name = toolNameById.get(event.id);
              if (!event.isError && name && DRAFT_MUTATING_TOOLS.has(name)) {
                void refreshDraftState();
                scheduleRouterRefresh(); // spec 15 D33 — re-render the server-side vault view
              }
              patchAssistant(assistantId, event);
              break;
            }
            case "permission_request":
              setStatusText(null);
              setPending({
                requestId: event.requestId,
                toolName: event.toolName,
                input: event.input,
                advisoryFindings: event.advisoryFindings,
              });
              break;
            case "permission_resolved":
              setPending((p) => (p && p.requestId === event.requestId ? null : p));
              break;
            case "turn_result":
              setStatusText(null);
              setSessionCost(event.sessionCostUsd);
              patchAssistant(assistantId, event);
              void refreshContext();
              flushRouterRefresh(); // spec 15 D33 — settle on final on-disk state
              break;
            default:
              patchAssistant(assistantId, event);
          }
        }
      } catch (e) {
        // An unmount-triggered abort (spec 15 D31) is not an error — the turn
        // keeps running server-side and is recoverable via the transcript; do
        // not paint an error bubble into a component that's going away.
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setStatusText(null);
          patchAssistant(assistantId, {
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      } finally {
        // Nothing further will arrive to trigger the next frame, so any text
        // still queued has to land now.
        flushPatches();
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        setPending(null);
        setStatusText(null);
        void refreshSessions();
      }
    },
    [
      flushPatches,
      patchAssistant,
      setTurns,
      setBusy,
      setPending,
      setStatusText,
      setSessionCost,
      sessionIdRef,
      setSession,
      refreshContext,
      refreshDraftState,
      refreshSessions,
      chatCtx,
      scheduleRouterRefresh,
      flushRouterRefresh,
      stopPolling,
      pinToBottom,
    ],
  );

  return { send };
}

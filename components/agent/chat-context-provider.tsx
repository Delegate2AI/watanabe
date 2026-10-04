"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { MAX_CHIPS, type MessageContext } from "@/lib/agent/context";

/**
 * Bridges a selection made in the native vault view (inside `<main>`) to the
 * docked chat panel (inside a sibling `<aside>`) — spec 11 D20. These are
 * server-rendered sibling subtrees with no shared client state today, so
 * `app/(site)/[[...slug]]/page.tsx` wraps both in this provider; the
 * selection toolbar calls `addChip`, `AgentChat`/the composer read
 * `pendingContext`/`removeChip`/`clearChips`.
 */

interface ChatContextValue {
  pendingContext: MessageContext[];
  addChip: (chip: MessageContext) => void;
  removeChip: (index: number) => void;
  clearChips: () => void;
  /**
   * The selection toolbar sits outside `AgentChat`'s own tree (it's mounted
   * inside `VaultMarkdown`, in the page's `<main>`), but still needs to
   * prefill the composer the same way a starter card does — so the prefill
   * request rides through this same bridge. `AgentChat` watches this and
   * forwards it into its own local `prefill` state (see agent-chat.tsx).
   */
  prefillRequest: { text: string; nonce: number } | null;
  requestPrefill: (text: string) => void;
  /**
   * The chat's own live view of its session's staged draft (spec 12 D26) —
   * `null` when there's nothing staged. Populated by `AgentChat` itself
   * (via `GET /api/agent/draft`) after a successful staging tool call and on
   * mount-time session restore; `DraftBanner` reads it to update without a
   * page reload. This is independent of the vault page's OWN server-rendered
   * draft data (`?draft=` — see `page.tsx`'s `resolveDraftView`), which is
   * what the banner shows on first paint before any chat activity.
   */
  draftState: { sessionId: string; changedFileCount: number } | null;
  setDraftState: (state: { sessionId: string; changedFileCount: number } | null) => void;
  /**
   * The title of the vault page currently open (spec 15 D30). The chat lives
   * in the persistent `(vault)` layout (spec 15 D29), which can't see page
   * params — so each page publishes its title here via `ChatPageContext`
   * (last-write-wins on navigation), and `AgentChat` reads it for the
   * "Ask about this page" starter. `null` until the first page reports in.
   */
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatContextProvider({ children }: { children: ReactNode }) {
  const [pendingContext, setPendingContext] = useState<MessageContext[]>([]);
  const [prefillRequest, setPrefillRequest] = useState<{ text: string; nonce: number } | null>(null);
  const [draftState, setDraftState] = useState<{ sessionId: string; changedFileCount: number } | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  const addChip = useCallback((chip: MessageContext) => {
    // Silently no-ops past the cap (spec 11 "degrade, don't block") — no
    // toast for v1; the toolbar stays usable, it just stops accumulating.
    setPendingContext((prev) => (prev.length >= MAX_CHIPS ? prev : [...prev, chip]));
  }, []);

  const removeChip = useCallback((index: number) => {
    setPendingContext((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearChips = useCallback(() => setPendingContext([]), []);

  const requestPrefill = useCallback((text: string) => {
    setPrefillRequest((p) => ({ text, nonce: (p?.nonce ?? 0) + 1 }));
  }, []);

  return (
    <ChatContext.Provider
      value={{
        pendingContext,
        addChip,
        removeChip,
        clearChips,
        prefillRequest,
        requestPrefill,
        draftState,
        setDraftState,
        pageTitle,
        setPageTitle,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

/** `null` outside a ChatContextProvider (e.g. `/chat`, `/embed` — not wrapped yet, see spec 11 Phase B). Callers must degrade gracefully. */
export function useChatContext(): ChatContextValue | null {
  return useContext(ChatContext);
}

"use client";

import { useEffect } from "react";
import { useChatContext } from "./chat-context-provider";

/**
 * Publishes the current vault page's title into `ChatContextProvider` (spec 15
 * D30), so the layout-mounted, navigation-persistent `AgentChat` (spec 15 D29)
 * can offer its "Ask about this page" starter for whatever page is open NOW.
 *
 * A layout can't see page params, so the page renders this tiny effect-only
 * bridge instead — the same provider-bridge idiom as spec 11 D20 (selection
 * chips) and spec 12 D26 (draft state). Last-write-wins on navigation; no
 * unmount cleanup, because leaving the vault unmounts the whole `(vault)`
 * layout (provider included) anyway.
 */
export function ChatPageContext({ title }: { title: string }) {
  const ctx = useChatContext();
  const setPageTitle = ctx?.setPageTitle;
  useEffect(() => {
    setPageTitle?.(title);
  }, [setPageTitle, title]);
  return null;
}

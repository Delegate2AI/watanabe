"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Turn } from "@/lib/agent/conversation";
import { NEAR_BOTTOM_PX } from "./chat-types";

/**
 * "Follow the bottom of the transcript unless the user has scrolled away."
 *
 * `stickToBottomRef` is the arming flag: while true, every change to the
 * transcript re-pins the view to `bottomRef`. `handleScroll` disarms it the
 * moment the viewport sits more than `NEAR_BOTTOM_PX` from the bottom, which
 * is also what raises the "Jump to latest" affordance. `send()` re-arms it via
 * `pinToBottom()` when a new turn starts.
 *
 * Two subtleties, both learned the hard way:
 *
 *  1. The follow-scroll is INSTANT, not smooth. A smooth `scrollIntoView`
 *     animates over hundreds of ms while tokens keep arriving, so its target
 *     is stale before it lands and it never reaches the real bottom. Worse,
 *     the animation's own intermediate scroll events run through
 *     `handleScroll`, which sees `distanceFromBottom > NEAR_BOTTOM_PX` and
 *     concludes the USER scrolled up — permanently disarming the flag
 *     mid-stream. An instant scroll lands at distance ~0, so `handleScroll`
 *     correctly reads "at bottom" and the flag survives. `scrollToBottom()`
 *     below stays smooth because that one is user-initiated.
 *
 *  2. `showThinking` is a dependency. The thinking indicator renders INSIDE
 *     the scroll container, so it grows the content without touching `turns`.
 */
export function useChatScroll(turns: Turn[], showThinking: boolean) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom);
  }, []);

  /** User-initiated ("Jump to latest") — smooth is right here. */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  /** Re-arm the follow behaviour — called when the user sends a new turn. */
  const pinToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    }
  }, [turns, showThinking]);

  return { bottomRef, scrollRef, showJumpToBottom, handleScroll, scrollToBottom, pinToBottom };
}

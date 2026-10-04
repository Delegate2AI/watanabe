"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Turn } from "@/lib/agent/conversation";

/**
 * How close (px) the viewport must sit to the bottom edge to still count as
 * "at the bottom". Wide enough to survive sub-pixel rounding and the last
 * partially revealed line, narrow enough that a deliberate scroll-up disarms.
 */
export const THREAD_NEAR_BOTTOM_PX = 80;

/**
 * "Follow the bottom of the transcript unless the user has scrolled away."
 *
 * The spec-24 thread's twin of components/agent/use-chat-scroll.ts, kept
 * separate so the two chat stacks stay decoupled (that one keys on the old
 * chat's showThinking prop; here every mid-stream growth flows through a new
 * `turns` array, so `turns` is the only dependency needed).
 *
 * `stickToBottomRef` is the arming flag: while true, every change to `turns`
 * re-pins the view to `bottomRef`. `handleScroll` disarms it the moment the
 * viewport sits more than `THREAD_NEAR_BOTTOM_PX` from the bottom, which is
 * also what raises the "Jump to latest" affordance. `pinToBottom()` re-arms
 * it when the user sends a new turn.
 *
 * The follow-scroll is INSTANT, not smooth (learned the hard way in the old
 * chat): a smooth `scrollIntoView` animates over hundreds of ms while tokens
 * keep arriving, so its target is stale before it lands, and the animation's
 * own intermediate scroll events run through `handleScroll`, which reads
 * "user scrolled up" and permanently disarms the flag mid-stream. An instant
 * scroll lands at distance ~0 and the flag survives. `scrollToBottom()` stays
 * smooth because that one is user-initiated.
 */
export function useThreadScroll(turns: Turn[]) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= THREAD_NEAR_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom);
  }, []);

  /** User-initiated ("Jump to latest"), so smooth is right here. */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  /** Re-arm the follow behaviour, called when the user sends a new turn. */
  const pinToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    }
  }, [turns]);

  return { bottomRef, scrollRef, showJumpToBottom, handleScroll, scrollToBottom, pinToBottom };
}

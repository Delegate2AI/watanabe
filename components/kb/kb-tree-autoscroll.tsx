"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scrolls the active KB tree row into view within the tree's own scroll
 * container whenever the open document changes (spec 25). The tree is a fully
 * expanded server component, so the active note can sit far down a long list and
 * off-screen; this brings it back without ever scrolling the page. Renders
 * nothing. It scrolls the nearest scrollable ancestor manually (not
 * `scrollIntoView`, which can also pan the window) and only when the row is
 * actually outside the viewport.
 */
export function KbTreeAutoScroll() {
  const pathname = usePathname();

  useEffect(() => {
    const active = document.querySelector<HTMLElement>(
      'nav[aria-label="Knowledge base"] [aria-current="page"]',
    );
    if (!active) return;
    const container = active.closest<HTMLElement>("[data-kb-scroll]");
    if (!container) {
      active.scrollIntoView({ block: "nearest" });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const above = activeRect.top < containerRect.top;
    const below = activeRect.bottom > containerRect.bottom;
    if (above || below) {
      // Center the row in the container, clamped by the container's own scroll.
      container.scrollTop +=
        activeRect.top - containerRect.top - container.clientHeight / 2 + activeRect.height / 2;
    }
  }, [pathname]);

  return null;
}

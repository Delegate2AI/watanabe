"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ActivityWindow } from "@/lib/people/activity";

/**
 * The window control on `/people`, and the page's only client island.
 *
 * It owns no state: the selected window lives in the `?window=` search param,
 * so choosing one pushes the URL and lets the server component re-render with
 * the new counts. Every other param is carried across, so a window switch never
 * silently drops a filter someone else added to the page later.
 */

const WINDOWS: { value: ActivityWindow; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export function ActivityWindowToggle({ value }: { value: ActivityWindow }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(next: ActivityWindow) {
    // Re-picking the current window would cost a server round trip and render
    // the identical page.
    if (next === value) return;
    const query = new URLSearchParams(params?.toString() ?? "");
    query.set("window", next);
    router.push(`${pathname}?${query.toString()}`);
  }

  return (
    <div
      role="group"
      aria-label="Activity window"
      className="inline-flex items-center gap-0.5 rounded-control border border-line bg-surface-2 p-0.5"
    >
      {WINDOWS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            // `aria-pressed` rather than `aria-selected`: these are toggle
            // buttons that navigate, not tabs over panels on this page.
            aria-pressed={active}
            onClick={() => select(option.value)}
            className={cn(
              "rounded-tab px-3 py-1 text-xs font-medium transition-colors",
              active ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

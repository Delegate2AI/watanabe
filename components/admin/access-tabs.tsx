"use client";

import { buttonClass } from "./access-ui";

/** The views the access admin offers, in the order the bar shows them. */
export const TABS = ["members", "groups", "tokens", "flags", "history"] as const;

export type Tab = (typeof TABS)[number];

/**
 * The tab bar, plus the one place the page names the signed-in person.
 *
 * Its own component so `access-admin.tsx` holds the state and the mutations
 * rather than also carrying this markup.
 */
export function AccessTabs({
  tab,
  onTab,
  email,
  role,
  viewerIsBootstrapAdmin = false,
}: {
  tab: Tab;
  onTab: (next: Tab) => void;
  email: string;
  role?: string;
  viewerIsBootstrapAdmin?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 p-2 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex gap-1" role="tablist" aria-label="Access views">
        {TABS.map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => onTab(value)}
            className={`${buttonClass} capitalize ${tab === value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:bg-surface-hover"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <span className="px-2 text-xs text-ink-faint" data-testid="signed-in-as">
        Signed in as <span className="font-medium text-ink">{email}</span>
        {role ? (
          <>
            {" "}with the <span className="font-medium capitalize text-ink" data-testid="viewer-role">{role}</span> role
            {viewerIsBootstrapAdmin ? " (granted by deployment configuration, so it is not listed below)" : null}
          </>
        ) : null}
      </span>
    </div>
  );
}

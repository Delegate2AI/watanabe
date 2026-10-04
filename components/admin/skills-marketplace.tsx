"use client";

import { buttonClass } from "./access-ui";
import type { MarketplaceItemRow, MarketplaceRow } from "./skills-types";

/**
 * The marketplace tab: every configured index and what it listed.
 *
 * Purely presentational. The indexes are LOADED by the install form, on the
 * first click of this tab, rather than resolved by the server page. Fetching
 * them on render would put a network fan-out on the critical path of a page that
 * `router.refresh()` re-runs after every mutation, so an admin installing five
 * picks would wait through six rounds of it, each one bounded by the slowest
 * index. Loading here means zero fetches for an admin who never opens the tab
 * and exactly one for an admin who does, because the result lives in the form's
 * state and survives every refresh.
 *
 * An index that could not be read, and a single entry an index got wrong, are
 * both rendered: a marketplace that quietly lists nothing is indistinguishable
 * from one that is broken. Every string here came off a remote document, so it
 * is rendered as text and never as markup.
 */
export function MarketplacePicker({
  configured,
  indexes,
  loading,
  error,
  pending,
  onReload,
  onInstall,
}: {
  /** How many indexes portal.yaml declares. Read on the server, no network. */
  configured: number;
  /** What the load returned, or null before it has run. */
  indexes: MarketplaceRow[] | null;
  loading: boolean;
  error: string;
  pending: boolean;
  onReload: () => void;
  onInstall: (index: string, item: MarketplaceItemRow) => Promise<void>;
}) {
  if (configured === 0) {
    // Only reachable when an operator has turned the built-in index off, since
    // it is offered by default: see lib/skills/marketplace-builtin.ts.
    return (
      <p className="text-sm text-ink-muted text-pretty">
        No marketplace index is available. Add one under skills.marketplaces in portal.yaml, or
        re-enable the built-in index with skills.builtinMarketplace.
      </p>
    );
  }
  if (loading) return <p className="text-sm text-ink-muted">Loading the marketplace indexes.</p>;
  if (error) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-amber-700 text-pretty">{error}</p>
        <div>
          <button type="button" onClick={onReload} className={`${buttonClass} bg-surface-2 text-ink`}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {(indexes ?? []).map((index) => (
        <div key={index.url} className="grid gap-2 rounded-lg bg-surface-2 p-3">
          <code className="text-xs text-ink-faint">{index.label ?? index.url}</code>
          {index.error && <p className="text-sm text-amber-700 text-pretty">{index.error}</p>}
          {(index.errors ?? []).map((issue) => (
            <p key={issue.item} className="text-xs text-amber-700 text-pretty">
              {issue.item}: {issue.reason}
            </p>
          ))}
          {(index.items ?? []).map((item) => (
            // Name and description share a column that is allowed to shrink,
            // and the button holds its own. Previously all three sat on one
            // wrapping flex line, so any longer description pushed the button
            // onto a line of its own: the buttons stopped forming a column and
            // the list became hard to scan. The visible label is the constant
            // "Install" for the same reason (uniform width); the skill name
            // stays in the accessible name.
            <div key={item.name} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-ink">{item.name}</span>
                <p className="text-xs text-ink-muted text-pretty">{item.description}</p>
              </div>
              <button
                type="button"
                disabled={pending}
                aria-label={`Install ${item.name}`}
                onClick={() => void onInstall(index.url, item)}
                className={`${buttonClass} shrink-0 bg-accent text-white`}
              >
                Install
              </button>
            </div>
          ))}
        </div>
      ))}
      <div>
        <button type="button" disabled={loading} onClick={onReload} className={`${buttonClass} bg-surface-2 text-ink`}>
          Reload indexes
        </button>
      </div>
    </div>
  );
}

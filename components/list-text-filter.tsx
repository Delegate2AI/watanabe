"use client";

import { useState } from "react";
import { Search } from "lucide-react";

/**
 * The one text filter every list surface uses (surface-polish P-12g).
 *
 * Deliberately client-side over the ALREADY-LOADED set, not a query API. These
 * lists are a screenful, they arrive server-rendered and clearance-scoped, and a
 * search endpoint would add a second authorization path for no reach. Filtering
 * what is on screen also cannot leak: a row the server never sent cannot match.
 */

export function useTextFilter(): {
  query: string;
  setQuery: (value: string) => void;
  /** True when `text` should stay visible. An empty query keeps everything. */
  matches: (text: string) => boolean;
} {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  return {
    query,
    setQuery,
    matches: (text: string) => needle === "" || text.toLowerCase().includes(needle),
  };
}

export function ListTextFilter({
  label,
  placeholder,
  value,
  onChange,
  className = "",
}: {
  /** The accessible name, e.g. "Filter projects". */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`relative max-w-sm ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-surface py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-accent"
      />
    </div>
  );
}

/** The line a list shows when a filter hides every row. */
export function NoMatches({ noun }: { noun: string }) {
  return <p className="text-sm text-ink-muted">No {noun} match that filter.</p>;
}

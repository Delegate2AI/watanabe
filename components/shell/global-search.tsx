"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { SearchGroup } from "@/lib/search/global";

/**
 * Global search command palette (spec 25/26/27/28). The header search icon and
 * Cmd/Ctrl-K both open it; it queries `/api/search`, which scopes every source
 * to the caller, and shows grouped results with keyboard navigation. Selecting
 * a result routes to it. This is purely a client shell over the authorized API.
 */
export function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  // The query the current `groups` actually answer. "No results." is only honest
  // once this matches the typed query; until then a cold-start search is still
  // in flight and the empty state would be a premature (and wrong) negative.
  const [resultsFor, setResultsFor] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flatten groups to a single ordered list for keyboard navigation.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setResultsFor("");
    setActive(0);
  }, []);

  // Cmd/Ctrl-K opens the palette from anywhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced query -> /api/search.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    // Nothing to fetch for a blank query; the render guard shows the prompt and
    // any prior results are hidden, so we avoid a synchronous state reset here.
    if (q === "") return;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setGroups([]);
          setResultsFor(q);
          return;
        }
        const data = (await res.json()) as { groups: SearchGroup[] };
        setGroups(data.groups ?? []);
        setResultsFor(q);
        setActive(0);
      } catch {
        // A failed search just shows nothing; the user can retry by typing.
        setGroups([]);
        setResultsFor(q);
      }
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  function go(href: string) {
    close();
    onNavigate?.();
    router.push(href);
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      go(flat[active].href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (Cmd+K)"
        aria-label="Search"
        className="grid size-7 place-items-center rounded-icon text-ink-muted hover:bg-surface-hover hover:text-ink"
      >
        <Search className="size-4" aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search chats, docs, and the knowledge base"
                aria-label="Search everything"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {query.trim() === "" ? (
                <p className="px-2 py-6 text-center text-sm text-ink-faint">
                  Search across your chats, files, and the knowledge base.
                </p>
              ) : flat.length === 0 && resultsFor !== query.trim() ? (
                // The search for the typed query has not settled yet; showing
                // "No results." here would be a premature negative on cold start.
                <p className="px-2 py-6 text-center text-sm text-ink-faint">Searching…</p>
              ) : flat.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-ink-faint">No results.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.label} className="mb-2">
                    <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                      {group.label}
                    </p>
                    <ul>
                      {group.items.map((item) => {
                        const index = flat.indexOf(item);
                        const isActive = index === active;
                        return (
                          <li key={`${group.label}:${item.href}:${item.title}`}>
                            <button
                              type="button"
                              onMouseEnter={() => setActive(index)}
                              onClick={() => go(item.href)}
                              className={
                                isActive
                                  ? "flex w-full flex-col items-start rounded-md bg-surface-2 px-2 py-1.5 text-left"
                                  : "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                              }
                            >
                              <span className="truncate text-sm text-ink">{item.title}</span>
                              {item.snippet ? (
                                <span className="line-clamp-1 text-xs text-ink-muted">{item.snippet}</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

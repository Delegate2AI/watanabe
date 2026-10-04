"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

/**
 * The KB search field (spec 25). Submitting navigates to `/kb/search?q=`, the
 * clearance-scoped results page. A tiny client island: the search itself runs
 * server-side against `vaultRootFor(clearance)`, so results never include
 * restricted matches.
 */
export function SearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const q = value.trim();
    if (q) router.push(`/kb/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form role="search" onSubmit={submit} className={className}>
      <div className="flex items-center gap-2 rounded-menu border border-line bg-surface px-3 py-1.5 focus-within:border-accent">
        {/* An explicit submit button, not a decorative icon: it gives a reliable
            click path AND guarantees Enter submits the field (a form with a
            submit button always implicitly submits from a text input), instead
            of leaning on the lone-input implicit-submission quirk that left the
            box doing nothing. */}
        <button
          type="submit"
          aria-label="Search"
          className="grid shrink-0 place-items-center text-ink-faint hover:text-ink"
        >
          <Search className="size-4" aria-hidden />
        </button>
        <input
          type="search"
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search the knowledge base"
          aria-label="Search the knowledge base"
          className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
    </form>
  );
}

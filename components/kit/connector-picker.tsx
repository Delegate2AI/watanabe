"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { codeFromBody, messageFor } from "@/lib/errors/messages";
import { notifyFailure } from "@/lib/ui/toast";

/** One entry of GET /api/connectors: display fields only, nothing sensitive. */
interface ConnectorOption {
  slug: string;
  title: string;
  transport: string;
  auth?: "oauth";
  connected?: boolean;
}

/**
 * The composer's per-thread connector opt-in menu (spec 33), modeled on
 * ModelSelector: the same popover shape and the same optimistic-update-then-
 * persist write, except rows are checkboxes (several connectors can be on at
 * once) so the menu stays open across toggles.
 *
 * Renders nothing until the clearance-filtered list arrives, and nothing at
 * all when it is empty: a workspace with no connectors (or the flag off
 * server-side, where the list route 404s) shows no button. The thread's
 * stored slugs are RAW and may reference retired or since-uncleared
 * connectors, so the count badge and the checked rows both come from the
 * intersection with the offered list, never the stored set alone.
 *
 * With no thread yet (Home, or a new chat before its first turn) the button
 * renders disabled with a hint: enablement is a per-thread row, so there is
 * nothing to write onto until the first send mints the thread.
 */
export function ConnectorPicker({ threadId }: { threadId: string | null }) {
  const [open, setOpen] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/connectors");
        if (!res.ok) return;
        const data = (await res.json()) as { connectors?: ConnectorOption[] };
        if (!cancelled && Array.isArray(data.connectors)) setConnectors(data.connectors);
      } catch {
        // No list, no button: the picker degrades to absent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/threads/${threadId}/connectors`);
        if (!res.ok) return;
        const data = (await res.json()) as { enabled?: string[] };
        if (!cancelled && Array.isArray(data.enabled)) setEnabled(new Set(data.enabled));
      } catch {
        // Unknown state reads as "none enabled" until the next successful read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  async function toggle(slug: string, next: boolean) {
    if (!threadId) return;
    const apply = (on: boolean) =>
      setEnabled((prev) => {
        const s = new Set(prev);
        if (on) s.add(slug);
        else s.delete(slug);
        return s;
      });
    // Optimistic: the row flips now, the write follows, a failure reverts.
    apply(next);
    try {
      const res = await fetch(`/api/threads/${threadId}/connectors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, enabled: next }),
      });
      if (!res.ok) {
        apply(!next);
        notifyFailure(messageFor(codeFromBody(await res.json().catch(() => null))));
        return;
      }
      // Adopt the server's stored set (still raw: rendering re-intersects).
      const data = (await res.json().catch(() => null)) as { enabled?: string[] } | null;
      if (data && Array.isArray(data.enabled)) setEnabled(new Set(data.enabled));
    } catch {
      apply(!next);
      notifyFailure(messageFor(undefined));
    }
  }

  if (connectors.length === 0) return null;

  const activeCount = connectors.filter((c) => enabled.has(c.slug)).length;

  if (!threadId) {
    // The wrapper span carries the title so the explanation still shows when
    // the button is disabled (a disabled button gets no hover events).
    const hint = "Send a message first to choose connectors for this chat.";
    return (
      <span title={hint} className="inline-flex">
        <button
          type="button"
          aria-label="Connectors"
          disabled
          title={hint}
          className="grid size-[30px] place-items-center rounded-control border border-line bg-surface text-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plug className="size-4" />
        </button>
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Connectors"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Connectors"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-[30px] place-items-center rounded-control border border-line bg-surface text-ink-muted hover:bg-surface-2"
      >
        <Plug className="size-4" />
        {activeCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-semibold leading-none text-white">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-menu border border-line bg-surface p-1.5 shadow-elevated"
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Connectors
          </div>
          {connectors.map((c) =>
            c.auth === "oauth" && !c.connected ? (
              <div
                key={c.slug}
                role="menuitem"
                aria-disabled="true"
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-ink-faint"
              >
                <span className="flex-1 truncate">{c.title}</span>
                <Link href="/connectors" className="shrink-0 text-[11px] font-medium text-accent underline">
                  Connect first
                </Link>
              </div>
            ) : (
              <button
                key={c.slug}
                type="button"
                role="menuitemcheckbox"
                aria-checked={enabled.has(c.slug)}
                onClick={() => void toggle(c.slug, !enabled.has(c.slug))}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2"
              >
                <Check
                  className={cn("size-3.5 shrink-0", enabled.has(c.slug) ? "text-accent" : "invisible")}
                  aria-hidden
                />
                <span className="flex-1 truncate">{c.title}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{c.transport}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

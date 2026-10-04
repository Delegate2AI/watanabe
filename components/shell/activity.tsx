"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { formatDateTime, formatRelative } from "@/lib/ui/date";
import type { ActivityFeed, ActivityItem } from "@/lib/activity/aggregate";

const EMPTY_FEED: ActivityFeed = {
  tasks: [],
  meetings: [],
  sharedDocs: [],
  accessRequests: [],
  taskComments: [],
  unreadCount: 0,
};

const SECTIONS = [
  { key: "tasks", title: "Tasks proposed for you" },
  { key: "meetings", title: "New meetings" },
  { key: "sharedDocs", title: "Shared with you" },
  { key: "accessRequests", title: "Waiting on you" },
  { key: "taskComments", title: "Task comments" },
] as const;

function ActivityRow({ item, onSelect }: { item: ActivityItem; onSelect: (id: string) => void }) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={() => onSelect(item.id)}
        className="block rounded-lg px-2.5 py-2 hover:bg-surface-hover"
      >
        <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
        <span className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-faint">
          <VisibilityChip visibility={item.visibility} group={item.group} />
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
            {formatRelative(item.createdAt)}
          </time>
        </span>
      </Link>
    </li>
  );
}

/**
 * The activity bell.
 *
 * Opening the panel reads (`GET /api/activity`) and writes nothing. Only "Mark
 * all seen" advances the server cursor, so reading the list no longer destroys
 * it: an item stays unread until someone says otherwise.
 *
 * Clicking through to one item retires that item alone. That retirement is held
 * here rather than on the server because the server keeps a single last-seen
 * timestamp per person, and advancing it far enough to cover one item would
 * silently cover everything older than it too. The cursor stays put; "Mark all
 * seen" remains the one control that moves it.
 */
export function Activity({ enabled = false }: { enabled?: boolean }) {
  const [feed, setFeed] = useState<ActivityFeed>(EMPTY_FEED);
  // The route the panel was opened on, rather than a bare boolean. A popover
  // that outlives the page it was opened on ends up floating over the next
  // page's header, and deriving "open" from the current route closes it on a
  // navigation without an effect that fights the render.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [retired, setRetired] = useState<ReadonlySet<string>>(() => new Set<string>());
  const container = useRef<HTMLDivElement>(null);
  const route = usePathname() ?? "";
  const open = openedOn !== null && openedOn === route;

  const setOpen = useCallback((next: boolean): void => {
    setOpenedOn(next ? route : null);
  }, [route]);

  const load = useCallback(async (): Promise<ActivityFeed | null> => {
    const response = await fetch("/api/activity", { cache: "no-store" });
    return response.ok ? await response.json() as ActivityFeed : null;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void load().then((next) => {
      if (active && next) setFeed(next);
    });
    return () => { active = false; };
  }, [enabled, load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  const visible = useMemo(() => {
    // Tolerates a missing group: during a rollout a browser holding the previous
    // bundle reads the new payload and vice versa, and one absent key must not
    // take the whole bell down.
    const keep = (items: ActivityItem[] = []): ActivityItem[] => items.filter((item) => !retired.has(item.id));
    const tasks = keep(feed.tasks);
    const meetings = keep(feed.meetings);
    const sharedDocs = keep(feed.sharedDocs);
    const accessRequests = keep(feed.accessRequests);
    const taskComments = keep(feed.taskComments);
    return {
      tasks,
      meetings,
      sharedDocs,
      accessRequests,
      taskComments,
      unreadCount:
        tasks.length + meetings.length + sharedDocs.length + accessRequests.length + taskComments.length,
    };
  }, [feed, retired]);

  async function markAllSeen(): Promise<void> {
    setMarking(true);
    try {
      const response = await fetch("/api/activity/seen", { method: "POST" });
      if (response.ok) {
        setFeed(EMPTY_FEED);
        setRetired(new Set<string>());
      }
    } finally {
      setMarking(false);
    }
  }

  function selectItem(id: string): void {
    setRetired((current) => new Set([...current, id]));
    setOpen(false);
  }

  if (!enabled) return null;
  const countLabel = `${visible.unreadCount} new ${visible.unreadCount === 1 ? "item" : "items"}`;

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        aria-label="Activity"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Reads only. Opening used to be indistinguishable from acknowledging.
          if (next) void load().then((fresh) => { if (fresh) setFeed(fresh); });
        }}
        className="relative grid size-8 place-items-center rounded-full border border-line bg-surface text-ink-muted shadow-card hover:bg-surface-hover hover:text-ink"
      >
        <Bell className="size-4" aria-hidden />
        {visible.unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white">
            <span aria-hidden>{visible.unreadCount > 99 ? "99+" : visible.unreadCount}</span>
            <span className="sr-only">{countLabel}</span>
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="What's new"
          className="absolute right-0 top-10 z-30 w-80 rounded-xl border border-line bg-surface p-2 shadow-xl"
        >
          <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
            <h2 className="text-sm font-semibold text-ink">What&apos;s new</h2>
            <button
              type="button"
              disabled={marking || visible.unreadCount === 0}
              onClick={() => void markAllSeen()}
              className="text-xs font-medium text-accent disabled:text-ink-faint"
            >
              Mark all seen
            </button>
          </div>
          {visible.unreadCount === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-ink-faint">You&apos;re all caught up.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {SECTIONS.map(({ key, title }) => visible[key].length === 0 ? null : (
                <section key={key}>
                  <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
                  <ul className="space-y-0.5">
                    {visible[key].map((item) => <ActivityRow key={item.id} item={item} onSelect={selectItem} />)}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

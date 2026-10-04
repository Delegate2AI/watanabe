"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isRouteActive } from "./nav-active";
import { NavItem } from "./nav-item";
import type { NavSection as Section } from "./sidebar-nav";

/**
 * A collapsible group of nav entries.
 *
 * Open state is remembered per viewer in localStorage, wrapped in try/catch on
 * both sides: a private window, cleared site data, or a browser set to block
 * storage all read as "no preference" and fall back to the section's default
 * rather than throwing inside a render.
 *
 * The section holding the current route opens regardless of what was stored, so
 * a deep link never lands somebody in a collapsed sidebar with no idea where
 * they are. That check and the leaf's own highlight share `isRouteActive`, so
 * they cannot disagree.
 */

const STORAGE_KEY = "watanabe:nav-sections";

function storedOpenState(id: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed[id] === "boolean" ? (parsed[id] as boolean) : null;
  } catch {
    return null;
  }
}

/**
 * localStorage fires no event this component can subscribe to, and it does not
 * need one: the value is read once per mount and thereafter the viewer's own
 * clicks are the source of truth. A no-op subscribe is what
 * `useSyncExternalStore` wants for a store that never changes underneath us.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

function rememberOpenState(id: string, open: boolean): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed[id] = open;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Nothing to do. The preference is a convenience, not state anything depends on.
  }
}

export function NavSection({
  section,
  tasksCount,
  onNavigate,
}: {
  section: Section;
  /** The live Tasks badge, resolved server-side and threaded through. */
  tasksCount?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const holdsActiveRoute = section.children.some((child) => isRouteActive(child.href, pathname));

  // The server snapshot is null, so the server and the first client render
  // agree on the default and hydration matches; the remembered value arrives on
  // the next render. Derived rather than pushed into state by an effect, which
  // would be a cascading render.
  const remembered = useSyncExternalStore(
    subscribeToNothing,
    () => storedOpenState(section.id),
    () => null,
  );
  const [override, setOverride] = useState<boolean | null>(null);

  // Precedence: this viewer's click in this session, then the section holding
  // the route they are actually on, then what they left last time, then the
  // default.
  const open = override ?? (holdsActiveRoute || (remembered ?? section.defaultOpen));

  function countFor(child: Section["children"][number]): number | undefined {
    return child.href === "/tasks" ? tasksCount : child.count;
  }

  // Collapsing must never hide a number, so a closed section carries the sum of
  // what its children would have shown.
  const rolledUp = section.children.reduce((total, child) => total + (countFor(child) ?? 0), 0);
  const Icon = section.icon;

  function toggle(): void {
    const next = !open;
    setOverride(next);
    rememberOpenState(section.id, next);
  }

  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[13.5px] text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <Icon className="size-4 text-current" aria-hidden />
        {section.label}
        {!open && rolledUp > 0 && (
          <span className="ml-auto rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold tracking-wide text-accent-ink">
            {rolledUp}
          </span>
        )}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-ink-faint transition-transform duration-150",
            open && "rotate-90",
            !open && rolledUp > 0 ? "ml-1.5" : "ml-auto",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-px pl-3">
          {section.children.map((child) => (
            <NavItem key={child.href} {...child} count={countFor(child)} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

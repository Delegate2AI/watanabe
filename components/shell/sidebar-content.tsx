import Link from "next/link";
import { Sparkles, Plus } from "lucide-react";
import { GlobalSearch } from "./global-search";
import { NavItem } from "./nav-item";
import { ThreadLists } from "./thread-lists";
import type { ThreadSummary } from "@/lib/threads/summaries";
import { AppearanceToggle } from "./appearance-toggle";
import { NavSection } from "./nav-section";
import { buildNavSections, HOME_NAV_ENTRY } from "./sidebar-nav";

/**
 * The sidebar's inner column (spec 18): brand row, New chat, primary nav,
 * scrollable Pinned/Recents, and the appearance toggle footer. Rendered inside
 * both the desktop aside and the mobile sheet, so it is layout-agnostic.
 * `onNavigate` lets the mobile sheet close itself when a link is followed.
 * `tasksCount` is the live Tasks badge (spec 21/30): the layout resolves it
 * server-side and passes it here; undefined means render no badge.
 * `showAdmin` gates the Access admin entry the same way: the layout resolves
 * `can(email, "manageAccess")` server-side, so no client code re-derives it.
 * `showConnectors` (spec 33) is that same capability AND CONNECTORS_ENABLED,
 * and `showSkills` (spec 34) that same capability AND SKILLS_ENABLED, and
 * `showDesign` that same capability AND HTML_DOCUMENTS_ENABLED, so flag-off
 * leaves the nav byte-identical.
 * `threads` is the layout's server-rendered Pinned/Recents list, so the sidebar
 * paints its chats with the page instead of fetching them after hydration.
 * `showPeople` gates the /people entry on PEOPLE_ACTIVITY_ENABLED alone (the
 * layout resolves it server-side): that surface is visible to every viewer, so
 * it carries no capability check and sits in the primary nav next to Meetings
 * rather than with the admin entries below.
 * `showReview` gates the /review entry on KB_REVIEW_ENABLED AND the `approve`
 * capability, resolved in the layout the same way.
 */
export function SidebarContent({
  tasksCount,
  showAdmin,
  showConnectors,
  showConnectorsDirectory,
  showSkills,
  showSkillStudio,
  showDesign,
  threads,
  showPeople,
  showReview,
  showMcp,
  showUsage,
  showLlmKeys,
  showLlmAdmin,
  onNavigate,
}: {
  tasksCount?: number;
  showAdmin?: boolean;
  showConnectors?: boolean;
  showConnectorsDirectory?: boolean;
  showSkills?: boolean;
  showSkillStudio?: boolean;
  showDesign?: boolean;
  threads?: ThreadSummary[];
  showPeople?: boolean;
  showReview?: boolean;
  /** MCP_ENABLED alone: the page carries no credential and needs no capability. */
  showMcp?: boolean;
  showUsage?: boolean;
  showLlmKeys?: boolean;
  showLlmAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const sections = buildNavSections({
    showAdmin,
    showConnectors,
    showConnectorsDirectory,
    showSkills,
    showSkillStudio,
    showDesign,
    showPeople,
    showReview,
    showMcp,
    showUsage,
    showLlmKeys,
    showLlmAdmin,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-2.5">
      <div className="flex items-center gap-1.5 px-1.5 pb-2.5">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Sparkles className="size-4 text-accent" />
          <span className="text-sm">Watanabe</span>
        </Link>
        <div className="ml-auto flex gap-0.5">
          <GlobalSearch onNavigate={onNavigate} />
        </div>
      </div>

      <Link
        href="/"
        onClick={onNavigate}
        className="mb-2.5 flex items-center gap-2.5 rounded-menu border border-line bg-surface px-3 py-2 text-[13.5px] font-medium text-ink shadow-card hover:bg-surface-2"
      >
        <Plus className="size-4 text-accent" />
        New chat
      </Link>

      {/*
       * A plain overflow-y-auto div, not the Radix ScrollArea used elsewhere in
       * this file's history: ScrollArea wraps its children in an internal
       * `display: table` node, which drops block children out of normal flow
       * and let a NavSection row blow out to 553px wide in a ~248px column,
       * pushing its chevron off the visible edge where overflow-hidden clipped
       * it. This matches the plain-div idiom used by every other scroll region
       * in the shell (see e.g. Stage in main-frame.tsx).
       */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <nav className="flex flex-col gap-0.5">
          <NavItem {...HOME_NAV_ENTRY} onNavigate={onNavigate} />
          {sections.map((section) => (
            <NavSection
              key={section.id}
              section={section}
              tasksCount={tasksCount}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-3">
          <ThreadLists onNavigate={onNavigate} initialThreads={threads} />
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 border-t border-line-soft px-1.5 pb-0.5 pt-2">
        <AppearanceToggle />
        <span className="text-xs text-ink-faint">Appearance</span>
      </div>
    </div>
  );
}

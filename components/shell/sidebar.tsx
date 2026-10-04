"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar-content";
import type { ThreadSummary } from "@/lib/threads/summaries";

/**
 * The shell sidebar (spec 18), responsive without duplicating its content.
 *
 * At >= 860px it is the persistent left grid column. Under 860px the aside is
 * hidden and a hamburger (fixed, top-left) opens the same SidebarContent in an
 * off-canvas Sheet; following any link closes it via `onNavigate`. The 860px
 * breakpoint matches the mock.
 *
 * `tasksCount` is the live Tasks badge count, resolved server-side in the layout
 * (gated by TASKS_ENABLED) and threaded through both SidebarContent instances.
 * `showAdmin` is resolved the same way (server-side `can(email, "manageAccess")`),
 * `showConnectors` is that capability plus CONNECTORS_ENABLED (spec 33), and
 * `showSkills` that capability plus SKILLS_ENABLED (spec 34), and `showDesign`
 * that capability plus HTML_DOCUMENTS_ENABLED. `showPeople` is
 * PEOPLE_ACTIVITY_ENABLED alone, with no capability check, because that surface
 * is visible to every authenticated viewer. `showReview` is KB_REVIEW_ENABLED
 * plus the `approve` capability.
 */
export function Sidebar({
  tasksCount,
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
  threads,
}: {
  tasksCount?: number;
  showAdmin?: boolean;
  showConnectors?: boolean;
  showConnectorsDirectory?: boolean;
  showSkills?: boolean;
  showSkillStudio?: boolean;
  showDesign?: boolean;
  showPeople?: boolean;
  showReview?: boolean;
  showMcp?: boolean;
  showUsage?: boolean;
  showLlmKeys?: boolean;
  showLlmAdmin?: boolean;
  threads?: ThreadSummary[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="flex min-h-0 flex-col border-r border-line bg-sidebar max-[860px]:hidden">
        <SidebarContent
          tasksCount={tasksCount}
          showAdmin={showAdmin}
          showConnectors={showConnectors}
          showConnectorsDirectory={showConnectorsDirectory}
          showSkills={showSkills}
          showSkillStudio={showSkillStudio}
          showDesign={showDesign}
          showPeople={showPeople}
          showReview={showReview}
          showMcp={showMcp}
          showUsage={showUsage}
          showLlmKeys={showLlmKeys}
          showLlmAdmin={showLlmAdmin}
          threads={threads}
        />
      </aside>

      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="fixed left-3.5 top-3.5 z-30 hidden size-8 place-items-center rounded-icon border border-line bg-surface text-ink-muted shadow-card max-[860px]:grid"
      >
        <Menu className="size-4" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Primary navigation and recent conversations.
          </SheetDescription>
          <SidebarContent
            tasksCount={tasksCount}
            showAdmin={showAdmin}
            showConnectors={showConnectors}
            showConnectorsDirectory={showConnectorsDirectory}
            showSkills={showSkills}
            showSkillStudio={showSkillStudio}
            showDesign={showDesign}
            showPeople={showPeople}
            showReview={showReview}
            showMcp={showMcp}
            showUsage={showUsage}
            showLlmKeys={showLlmKeys}
            showLlmAdmin={showLlmAdmin}
            threads={threads}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

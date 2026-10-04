import {
  Briefcase,
  Home,
  Library,
  ListChecks,
  Calendar,
  Folder,
  Gauge,
  KeyRound,
  Coins,
  Boxes,
  Blocks,
  GitPullRequest,
  Palette,
  Plug,
  Server,
  Share2,
  ShieldCheck,
  Users,
  Wand2,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavEntry {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
  count?: number;
}

/**
 * Spec 30's `/admin/access`. Every entry below is conditional: the layout
 * resolves each gate server-side and `buildNavSections` includes the entry only
 * when it passes, mirroring each page's own `notFound()`. This one needs
 * `can(email, "manageAccess")`.
 */
export const ADMIN_NAV_ENTRY: NavEntry = {
  href: "/admin/access",
  label: "Access admin",
  icon: ShieldCheck,
};

/**
 * Spec 33's `/admin/connectors`: `can(email, "manageAccess") &&
 * isConnectorsEnabled()`. Labelled "Connector registry" rather than
 * "Connectors" because the member-facing directory below owns that word; the
 * two shipped with the identical label and the identical icon.
 */
export const CONNECTORS_NAV_ENTRY: NavEntry = {
  href: "/admin/connectors",
  label: "Connector registry",
  icon: Plug,
};

export const CONNECTORS_DIRECTORY_NAV_ENTRY: NavEntry = {
  href: "/connectors",
  label: "Connectors",
  icon: Plug,
};

export const SKILL_STUDIO_NAV_ENTRY: NavEntry = {
  href: "/skills",
  label: "Skill studio",
  icon: Wand2,
};

/**
 * Spec 34's `/admin/skills`: `can(email, "manageAccess") && isSkillsEnabled()`.
 * Labelled "Skill registry" for the same reason as the connector registry
 * above: "Skills" and "Skill studio" were not tellable apart in a flat list.
 */
export const SKILLS_NAV_ENTRY: NavEntry = {
  href: "/admin/skills",
  label: "Skill registry",
  icon: Blocks,
};

/**
 * The document design guide at `/admin/design`: `can(email, "manageAccess") &&
 * isHtmlDocumentsEnabled()`.
 */
export const DESIGN_NAV_ENTRY: NavEntry = {
  href: "/admin/design",
  label: "Document design",
  icon: Palette,
};

export const USAGE_NAV_ENTRY: NavEntry = {
  href: "/admin/usage",
  label: "Usage and cost",
  icon: Gauge,
};

/**
 * The people activity dashboard's `/people`, in the Work section. Unlike the
 * entries above it carries no capability check, only PEOPLE_ACTIVITY_ENABLED:
 * the surface shows every viewer exactly the meetings and tasks they are
 * already cleared to see, rearranged by person.
 */
export const PEOPLE_NAV_ENTRY: NavEntry = {
  href: "/people",
  label: "People",
  icon: Users,
};

/**
 * The KB review queue's `/review`, in the Knowledge section beside the base it
 * reviews: `isKbReviewEnabled() && can(email, "approve")`, so a viewer who
 * cannot merge a proposal is never shown a link to the queue.
 */
/**
 * Connecting an MCP client (spec 2026-09-05). No capability check and no flag
 * beyond MCP_ENABLED, which the layout resolves: the page carries no credential
 * and grants nothing by existing, and which tools a connected client gets is
 * decided by the viewer's own roles and clearance at call time.
 */
export const MCP_NAV_ENTRY: NavEntry = {
  href: "/settings/mcp",
  label: "MCP access",
  icon: Server,
};

/**
 * Personal LLM keys (spec 2026-10-03): the viewer's own keys, budgets and
 * harness snippets. LLM_KEYS_ENABLED alone; the page grants nothing by existing.
 */
export const LLM_KEYS_NAV_ENTRY: NavEntry = {
  href: "/settings/llm",
  label: "LLM keys",
  icon: KeyRound,
};

/** Budgets, model groups and budget requests: `manageAccess` and LLM_KEYS_ENABLED, like the page. */
export const LLM_ADMIN_NAV_ENTRY: NavEntry = {
  href: "/admin/llm",
  label: "LLM budgets",
  icon: Coins,
};

export const REVIEW_NAV_ENTRY: NavEntry = {
  href: "/review",
  label: "Review",
  icon: GitPullRequest,
};

// The Pinned/Recents thread lists are now live (spec 24): the sidebar fetches
// GET /api/threads via `components/shell/thread-lists.tsx`. The spec-18 stub
// arrays that used to live here are removed with that wiring.

/**
 * Home sits above the sections and belongs to none of them: it is the chat
 * front door, not a category.
 */
export const HOME_NAV_ENTRY: NavEntry = { href: "/", label: "Home", icon: Home };

export interface NavSection {
  id: string;
  label: string;
  icon: ComponentType<LucideProps>;
  /** Whether the section starts open for a viewer who has never touched it. */
  defaultOpen: boolean;
  children: NavEntry[];
}

/** What the server layout already resolved about this viewer. */
export interface NavVisibility {
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
}

/**
 * The nav, as four sections plus Home.
 *
 * This replaces a flat list of up to fifteen entries into which three of them
 * were spliced by matching on the href of the item before them, so reordering
 * the list silently relocated unrelated entries. Membership is declared here
 * instead, and every gate is the same boolean the layout already resolves
 * server-side, so flag-off still renders nothing.
 *
 * Knowledge and Work open by default; Integrations and Administration do not.
 * Most people never open the second pair, and leaving them closed is what puts
 * the thread list back near the top of the column.
 *
 * A section whose children are all gated away is dropped entirely rather than
 * rendered as an empty header.
 */
export function buildNavSections(visibility: NavVisibility): NavSection[] {
  const sections: NavSection[] = [
    {
      id: "knowledge",
      label: "Knowledge",
      icon: Library,
      defaultOpen: true,
      children: [
        { href: "/kb", label: "Knowledge base", icon: Library },
        ...(visibility.showReview ? [REVIEW_NAV_ENTRY] : []),
        { href: "/artifacts", label: "Artifacts", icon: Boxes },
        { href: "/docs", label: "My Shared Docs", icon: Share2 },
      ],
    },
    {
      id: "work",
      label: "Work",
      icon: Briefcase,
      defaultOpen: true,
      children: [
        { href: "/tasks", label: "Tasks", icon: ListChecks },
        { href: "/projects", label: "Projects", icon: Folder },
        { href: "/meetings", label: "Meetings", icon: Calendar },
        ...(visibility.showPeople ? [PEOPLE_NAV_ENTRY] : []),
      ],
    },
    {
      id: "integrations",
      label: "Integrations",
      icon: Plug,
      defaultOpen: false,
      children: [
        ...(visibility.showConnectorsDirectory ? [CONNECTORS_DIRECTORY_NAV_ENTRY] : []),
        ...(visibility.showSkillStudio ? [SKILL_STUDIO_NAV_ENTRY] : []),
        ...(visibility.showMcp ? [MCP_NAV_ENTRY] : []),
        ...(visibility.showLlmKeys ? [LLM_KEYS_NAV_ENTRY] : []),
      ],
    },
    {
      id: "administration",
      label: "Administration",
      icon: ShieldCheck,
      defaultOpen: false,
      children: [
        ...(visibility.showAdmin ? [ADMIN_NAV_ENTRY] : []),
        ...(visibility.showConnectors ? [CONNECTORS_NAV_ENTRY] : []),
        ...(visibility.showSkills ? [SKILLS_NAV_ENTRY] : []),
        ...(visibility.showDesign ? [DESIGN_NAV_ENTRY] : []),
        ...(visibility.showUsage ? [USAGE_NAV_ENTRY] : []),
        ...(visibility.showLlmAdmin ? [LLM_ADMIN_NAV_ENTRY] : []),
      ],
    },
  ];
  return sections.filter((section) => section.children.length > 0);
}

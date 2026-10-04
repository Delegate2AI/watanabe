import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { AccessButton } from "./access-button";
import type { KbTreeNode } from "@/lib/kb/tree";

/**
 * The KB file tree (spec 25). A server component: it renders exactly the nodes
 * it is handed, which come from `buildKbTree(vaultRootFor(clearance))`. A note
 * the requester is not cleared for is absent from those nodes, so it never
 * appears here. A restricted node carries a `VisibilityChip`, which always
 * means "restricted, and you are cleared" (absence, not a lock, is the
 * boundary). Sections are collapsible via native `<details>` disclosure, so the
 * tree keeps no client state and stays a server component; folders render open
 * by default. In `manage` mode
 * (admin-only), each node also renders an `AccessButton` (spec: KB file
 * access admin UI) that opens a client-side modal to edit its visibility.
 */

function routeHref(routeSlug: string[]): string {
  return `/kb/${routeSlug.map(encodeURIComponent).join("/")}`;
}

/**
 * The chip sits in its own fixed-width trailing column so a long restricting
 * group name cannot eat the title's width: every row's title gets the same
 * space, and the title truncates in CSS with the full text on hover rather than
 * being cut in the data.
 */
function ChipColumn({ group }: { group?: string }) {
  return (
    <span
      data-testid="kb-tree-chip-column"
      title={group}
      className="flex w-16 shrink-0 justify-end overflow-hidden"
    >
      <VisibilityChip visibility="restricted" group={group} className="whitespace-nowrap" />
    </span>
  );
}

function FileRow({ node, activeRoute, manage, groups }: { node: KbTreeNode; activeRoute: string; manage: boolean; groups: string[] }) {
  const route = node.routeSlug.join("/");
  const isActive = route === activeRoute;
  const linkContent = (
    <>
      <FileText className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={node.tooltip ?? node.name}>
        {node.name}
      </span>
      {node.visibility === "restricted" && <ChipColumn group={node.group} />}
    </>
  );

  if (!manage) {
    return (
      <Link
        href={routeHref(node.routeSlug)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group flex min-w-0 items-center gap-1.5 rounded-menu px-2 py-1 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink",
          isActive && "bg-surface-2 font-medium text-ink",
        )}
      >
        {linkContent}
      </Link>
    );
  }

  // Manage mode: an interactive <button> (AccessButton) cannot legally nest
  // inside the row's <a> (invalid interactive-in-interactive HTML). The
  // button becomes a sibling of the Link in a flex wrapper instead of a
  // descendant, so the two controls stay independently clickable.
  return (
    <div className="group flex items-center gap-1.5 rounded-menu">
      <Link
        href={routeHref(node.routeSlug)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink",
          isActive && "bg-surface-2 font-medium text-ink",
        )}
      >
        {linkContent}
      </Link>
      {node.path && <AccessButton path={node.path} isDirectory={false} groups={groups} />}
    </div>
  );
}

function TreeNodes({ nodes, activeRoute, depth, manage, groups }: { nodes: KbTreeNode[]; activeRoute: string; depth: number; manage: boolean; groups: string[] }) {
  return (
    <ul className={cn("flex flex-col gap-px", depth > 0 && "ml-3 border-l border-line-soft pl-1.5")}>
      {nodes.map((node) => (
        <li key={node.routeSlug.join("/") || node.name}>
          {node.isDirectory ? (
            <details open>
              <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1 rounded-menu px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint hover:bg-surface-hover hover:text-ink [&::-webkit-details-marker]:hidden">
                {/* Direct-child variant so nesting scopes correctly: the chevron
                    rotates only when ITS OWN <details> is open, never because an
                    ancestor folder happens to be open. */}
                <ChevronRight
                  className="size-3 shrink-0 transition-transform duration-150 [[open]>summary>&]:rotate-90"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate" title={node.name}>
                  {node.name}
                </span>
                {manage && node.path && <AccessButton path={node.path} isDirectory groups={groups} />}
              </summary>
              <TreeNodes nodes={node.children ?? []} activeRoute={activeRoute} depth={depth + 1} manage={manage} groups={groups} />
            </details>
          ) : (
            <FileRow node={node} activeRoute={activeRoute} manage={manage} groups={groups} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function KbTree({
  nodes,
  activeRoute,
  manage = false,
  groups = [],
}: {
  nodes: KbTreeNode[];
  activeRoute: string;
  manage?: boolean;
  groups?: string[];
}) {
  if (nodes.length === 0) {
    return <p className="px-2 py-1 text-[13px] text-ink-faint">No documents in your view.</p>;
  }
  return (
    <nav aria-label="Knowledge base" className="text-ink">
      <TreeNodes nodes={nodes} activeRoute={activeRoute} depth={0} manage={manage} groups={groups} />
    </nav>
  );
}

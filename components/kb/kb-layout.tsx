import type { ReactNode } from "react";
import Link from "next/link";
import { KbTree } from "./kb-tree";
import { KbTreeAutoScroll } from "./kb-tree-autoscroll";
import type { KbTreeNode } from "@/lib/kb/tree";

export function KbLayout({
  tree,
  activeRoute,
  children,
  manage = false,
  isAdmin = false,
  groups = [],
  basePath = "/kb",
}: {
  tree: KbTreeNode[];
  activeRoute: string;
  children: ReactNode;
  manage?: boolean;
  isAdmin?: boolean;
  groups?: string[];
  /** The path of the page this toggle sits on, so the mode keeps the open note. */
  basePath?: string;
}) {
  // Both directions carry the current path. A fixed `/kb` pair dropped the open
  // note on the way in AND on the way out, and the way out kept `manage=1`, so
  // the control that says "Done managing" never actually left the mode.
  const toggleHref = manage ? basePath : `${basePath}?manage=1`;
  return (
    <div className="flex min-h-full">
      <aside
        data-kb-scroll
        className="hidden w-64 shrink-0 overflow-y-auto border-r border-line-soft p-3 md:block"
      >
        <KbTreeAutoScroll />
        {isAdmin && (
          <div className="mb-2 flex justify-end">
            <Link
              href={toggleHref}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              {manage ? "Done managing" : "Manage access"}
            </Link>
          </div>
        )}
        <KbTree nodes={tree} activeRoute={activeRoute} manage={manage} groups={groups} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

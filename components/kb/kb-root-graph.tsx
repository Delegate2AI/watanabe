"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

/**
 * The vault graph on the KB landing page (`/kb` with no note open). The KB
 * page is a server component, so this client wrapper exists to hold the
 * `next/dynamic` import: `ssr: false` because the canvas measures its own
 * container, and a dynamic import (not static) so `d3-force` stays out of the
 * `/kb` bundle for every reader who lands on a note, and entirely when the
 * graph flag is off (the page renders this component only behind
 * `isKbGraphEnabled()`).
 */
const GraphPanel = dynamic(
  () => import("@/components/kb/graph/graph-panel").then((mod) => mod.GraphPanel),
  { ssr: false },
);

export function KbRootGraph() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Vault map
        </h2>
        <Link
          href="/map?view=graph"
          className="text-xs font-medium text-ink-muted hover:text-ink"
        >
          Open full map
        </Link>
      </div>
      {/*
        The definite height lives HERE, exactly like the Graph tab on /map: a
        canvas with no CSS height falls back to its 300x150 intrinsic ratio,
        and the container's `h-full` cannot resolve against an indefinite
        parent. 65vh keeps the search box and this header in view above it.
      */}
      <div data-testid="kb-root-graph-pane" className="h-[65vh]">
        <GraphPanel />
      </div>
    </div>
  );
}

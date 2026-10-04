"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Two representations of one orientation surface. The list is server-rendered
 * and handed in as `list`; the graph mounts lazily, so a reader who never opens
 * that tab never pays for the fetch.
 *
 * `next/dynamic` and not a static import, because Radix unmounting the inactive
 * `TabsContent` makes only the FETCH lazy. A static import would still pull
 * `graph-canvas` and, behind it, `d3-force` into this page's client bundle for
 * every visitor, including everyone the flag is off for. `ssr: false` because
 * the thing being loaded is a canvas that measures its own container, so a
 * server pass buys nothing.
 *
 * `initialView` comes from the server (the page reads `?view=` itself and
 * passes the result down) rather than being read from `window.location` in a
 * lazy `useState` initializer. That initializer would run once on the server,
 * where there is no `window` and it would always resolve to "list", and again
 * on hydration, where it would resolve to "graph": a direct `/map?view=graph`
 * link would paint the List tab and flip to Graph after hydrate. Reading the
 * param on the server removes that mismatch instead of merely silencing it.
 *
 * Tab state is written with `history.replaceState`, NOT `router.replace`: the
 * page is `force-dynamic`, so a router navigation would round-trip to the
 * server merely to switch a tab. This keeps the URL shareable at no cost.
 *
 * Flag-off renders the list bare, with no tab chrome at all, and the dynamic
 * import above means the graph's own code never reaches the bundle either, so
 * `/map` is what it was before the graph existed.
 */
const GraphPanel = dynamic(
  () => import("@/components/kb/graph/graph-panel").then((mod) => mod.GraphPanel),
  { ssr: false },
);

export function MapTabs({
  list,
  graphEnabled,
  initialView,
}: {
  list: ReactNode;
  graphEnabled: boolean;
  initialView: "list" | "graph";
}) {
  const [view, setView] = useState(initialView);

  if (!graphEnabled) return <>{list}</>;

  function select(next: string): void {
    setView(next === "graph" ? "graph" : "list");
    const url = new URL(window.location.href);
    if (next === "list") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState({}, "", url);
  }

  return (
    <Tabs value={view} onValueChange={select}>
      <TabsList className="mb-4">
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="graph">Graph</TabsTrigger>
      </TabsList>
      <TabsContent value="list">{list}</TabsContent>
      {/*
        The height is set HERE and nowhere below. A `<canvas>` with no CSS
        height falls back to its 300x150 intrinsic ratio, and the container's
        `h-full` cannot resolve against a parent that has no definite height
        either, so the pane rendered about half as tall as the column is wide.
        70vh keeps the page header and the tab strip in view above it.
      */}
      <TabsContent value="graph" className="h-[70vh]">
        <GraphPanel />
      </TabsContent>
    </Tabs>
  );
}

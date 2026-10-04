import { log } from "@/lib/log";
import { buildBacklinkGraph } from "@/lib/authority/backlinks";
import { buildKbGraph, type KbGraph } from "./graph";

/**
 * Per-clearance-root cache for the KB link graph.
 *
 * Both halves of the builder read every `.md` in the projection, so this is not
 * a per-request cost. Mirrors `lib/index/cache.ts`: pinned to `globalThis`
 * because Next.js can bundle route handlers separately and dev HMR would
 * otherwise drop the cache on every module reload.
 *
 * One difference from the index cache: it is keyed BY ROOT, because the root
 * varies per clearance while the index's does not.
 *
 * Invalidation works the same way the index's does, and for the same reason.
 * This module never calls back into `refreshRepo()`, which would close an
 * import cycle. Instead the callers that move the read-serving checkout call
 * `clearKbGraphCache()` right where they already call `rebuildIndex()`: the
 * GitLab push webhook (`app/api/repo/refresh/route.ts`) and both direct-mode
 * write paths (`lib/kb-mcp/write-tools.ts`, `lib/kb-write/publish-core.ts`).
 * The TTL is the floor under that, not the only mechanism: it tracks the repo
 * refresh interval, so even a checkout moved by nothing but the poller shows a
 * merged note within one interval.
 *
 * NEVER THROWS. This sits on a request path: a scan failure serves the last
 * good graph for that root, or an empty one, and never crashes the caller.
 */

const EMPTY: KbGraph = { nodes: [], edges: [], total: 0 };

/** Matches the default `REPO_REFRESH_INTERVAL_MS` in `instrumentation.ts`. */
export const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000;

interface Entry {
  graph: KbGraph;
  builtAt: number;
}

const g = globalThis as unknown as { __kbGraphCache?: Map<string, Entry> };

function store(): Map<string, Entry> {
  g.__kbGraphCache ??= new Map<string, Entry>();
  return g.__kbGraphCache;
}

export function clearKbGraphCache(): void {
  store().clear();
  backlinkStore().clear();
}

export function getKbGraph(root: string, now: number = Date.now()): KbGraph {
  const cached = store().get(root);
  if (cached && now - cached.builtAt < GRAPH_CACHE_TTL_MS) return cached.graph;

  try {
    const graph = buildKbGraph(root);
    store().set(root, { graph, builtAt: now });
    return graph;
  } catch (err) {
    log.warn("kb graph: build failed, serving last known good", { root, err: String(err) });
    // Do NOT restamp `builtAt`: a failing root should retry on the next call
    // rather than serve a stale graph for another whole interval.
    return cached?.graph ?? EMPTY;
  }
}

interface BacklinkEntry {
  graph: Record<string, string[]>;
  builtAt: number;
}

const b = globalThis as unknown as { __kbBacklinkCache?: Map<string, BacklinkEntry> };

function backlinkStore(): Map<string, BacklinkEntry> {
  b.__kbBacklinkCache ??= new Map<string, BacklinkEntry>();
  return b.__kbBacklinkCache;
}

/**
 * The raw reverse link map, cached on the same TTL as the graph. `backlinksFor`
 * rebuilt this on every single note render before this existed. Never throws:
 * an empty map means "no backlinks", which is what a fresh vault looks like.
 */
export function getBacklinkGraph(root: string, now: number = Date.now()): Record<string, string[]> {
  const cached = backlinkStore().get(root);
  if (cached && now - cached.builtAt < GRAPH_CACHE_TTL_MS) return cached.graph;
  try {
    const graph = buildBacklinkGraph(root);
    backlinkStore().set(root, { graph, builtAt: now });
    return graph;
  } catch (err) {
    log.warn("kb backlinks: build failed, serving last known good", { root, err: String(err) });
    return cached?.graph ?? {};
  }
}

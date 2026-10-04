import Link from "next/link";
import { notFound } from "next/navigation";
import { Map } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { MapTabs } from "@/components/map/map-tabs";
import { getIndex, rebuildIndex } from "@/lib/index/cache";
import { isIndexEnabled } from "@/lib/index/config";
import { isKbGraphEnabled } from "@/lib/kb/graph-config";
import { vaultDocHref } from "@/lib/index/web-links";

/**
 * The web vault map (spec 14, subsystem A3): a generated, flat, grouped
 * navigation of every knowledge-base document, rendered from the same
 * ephemeral `IndexMap` the `kb_index` agent tool serves. The flat list is one of
 * two tabs: the Graph tab (KB_GRAPH_ENABLED) renders the same vault as its link
 * graph. The list stays because it is the representation that survives no
 * JavaScript, a phone, and a screen reader, none of which a canvas does.
 *
 * Gated on `isIndexEnabled()`: with the flag off the route is a hard 404
 * (`notFound()`), so a disabled index leaves no new reachable surface. Identity
 * is resolved once in the `(app)` layout and inherited here, exactly like the
 * sibling content routes, so this page needs no identity handling of its own.
 *
 * `force-dynamic` because the index is a live process-singleton / filesystem
 * read, never a build-time constant, so it must render per request rather than
 * be statically prerendered.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function groupLabel(dir: string): string {
  return dir === "." ? "Vault root" : dir;
}

export default async function VaultMapPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (!isIndexEnabled()) notFound();

  const map = getIndex() ?? rebuildIndex();
  const view = (await searchParams)?.view === "graph" ? "graph" : "list";

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Map}
        eyebrow="Vault map"
        title="Map of the knowledge base"
        description={`A generated map of every document, grouped by section. ${map.count} ${
          map.count === 1 ? "note" : "notes"
        } across ${map.groups.length} ${map.groups.length === 1 ? "section" : "sections"}.`}
      />

      <MapTabs
        graphEnabled={isKbGraphEnabled()}
        initialView={view}
        list={
          map.groups.length === 0 ? (
            <div className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-muted">
              The knowledge base is empty, or the index has not been built yet.
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {map.groups.map((group) => (
                <section key={group.dir}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    {groupLabel(group.dir)}
                  </h3>
                  <ul className="flex flex-col gap-px">
                    {group.docs.map((doc) => (
                      <li key={doc.path}>
                        <Link
                          href={vaultDocHref(doc.path)}
                          className="block rounded-menu px-3 py-2 hover:bg-surface-hover"
                        >
                          <span className="text-[13.5px] font-medium text-ink">{doc.title}</span>
                          {doc.description && (
                            <span className="mt-0.5 block max-w-[72ch] text-xs text-ink-muted text-pretty">
                              {doc.description}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )
        }
      />
    </div>
  );
}

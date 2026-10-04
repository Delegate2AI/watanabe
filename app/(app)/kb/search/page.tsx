import { requesterVaultRoot } from "@/lib/kb/request";
import { buildKbTree } from "@/lib/kb/tree";
import { searchKb } from "@/lib/kb/search";
import { KbLayout } from "@/components/kb/kb-layout";
import { SearchBox } from "@/components/kb/search-box";
import { SearchResult } from "@/components/kb/search-result";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The KB search results page (spec 25). Results come from `searchKb` scoped to
 * `vaultRootFor(clearance)`, the same backend the agent uses, so a restricted
 * match is physically unreachable and never appears. This is the destination
 * of the sidebar / KB search field.
 */
export default async function KbSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const { root } = await requesterVaultRoot();

  const tree = buildKbTree(root);
  const rows = query ? await searchKb(query, root) : [];

  return (
    <KbLayout tree={tree} activeRoute="">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <SearchBox className="mb-6" />
        {query === "" ? (
          <p className="text-[15px] text-ink-faint">Type a query to search the knowledge base.</p>
        ) : rows.length === 0 ? (
          <p className="text-[15px] text-ink-faint">
            No results for <span className="font-medium text-ink">{query}</span>.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-ink-faint">
              {rows.length} {rows.length === 1 ? "result" : "results"} for{" "}
              <span className="font-medium text-ink">{query}</span>
            </p>
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <SearchResult key={row.route} row={row} />
              ))}
            </ul>
          </>
        )}
      </div>
    </KbLayout>
  );
}

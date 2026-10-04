import { KbLayout } from "@/components/kb/kb-layout";
import { SearchBox } from "@/components/kb/search-box";
import { requesterKbRoots } from "@/lib/kb/request";
import { buildKbTree } from "@/lib/kb/tree";
import { loadGroups } from "@/lib/authority/groups";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The knowledge base's own not-found surface.
 *
 * Two things have to be true at once here, and rendering this from the page
 * component could only ever deliver one of them:
 *
 * 1. **It must be a real 404.** Returning a "no document here" pane from the
 *    page sends HTTP 200, so link checkers, caches and monitoring all record a
 *    broken KB URL as healthy. Reached through `notFound()`, this file renders
 *    with a 404 status.
 * 2. **It must not strand the reader.** The framework default is a bare "404
 *    This page could not be found" with no tree, no search and no way back, and
 *    readers arrive here from stale cross-links and from illustrative paths like
 *    `./x.md` written inside a doc, which the code-span linkifier turns into
 *    real links by design. So the tree and the search box are rendered here too.
 *
 * No existence oracle: a note absent from the requester's projection and a note
 * that never existed both land here, identically, and the tree is built from
 * that same requester-scoped root. The attempted path is deliberately not shown,
 * since this file cannot see it and does not need it.
 */
export default async function KbNotFound() {
  // Manage mode is a property of a request this file cannot read, so the tree is
  // always the plain read-scoped one. That is the safe direction: never the
  // wider admin projection.
  const { treeRoot, isAdmin } = await requesterKbRoots(false);
  const tree = buildKbTree(treeRoot);
  const groups = isAdmin ? Object.keys(loadGroups()) : [];

  return (
    <KbLayout tree={tree} activeRoute="" manage={false} isAdmin={isAdmin} groups={groups} basePath="/kb">
      <div className="border-b border-line-soft p-3">
        <SearchBox />
      </div>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-[15px] text-ink">There is no document at this path.</p>
        <p className="mt-1 text-[15px] text-ink-faint">
          It may have moved or been renamed, or the link may be an example rather than a real note. Pick a
          document from the tree, or search the knowledge base above.
        </p>
      </div>
    </KbLayout>
  );
}

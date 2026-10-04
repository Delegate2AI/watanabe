import { unauthorized } from "@/lib/auth/identity";
import { fail } from "@/lib/errors/codes";
import { resolveIdentity } from "@/lib/identity/resolve";
import { vaultRootFor } from "@/lib/repo";
import { getKbGraph } from "@/lib/kb/graph-cache";
import { isKbGraphEnabled } from "@/lib/kb/graph-config";
import { overlayTaskNodes } from "@/lib/kb/graph-tasks";
import { isTasksEnabled } from "@/lib/tasks/config";
import { getDb } from "@/lib/db/client";
import { listKbAnchoredTasks } from "@/lib/db/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The knowledge base link graph, for the graph tab on `/map` (spec:
 * 2026-08-13-kb-graph-view-design).
 *
 * Reads ONLY through `vaultRootFor(clearance)`, the same clearance-scoped seam
 * the `/kb` page uses: a note the requester is not cleared for is absent from
 * that root, so it is absent from the node list and from every edge. Absence is
 * the boundary; there is no per-node check, and `total` counts nodes in the
 * requester's own projection, so it cannot leak a vault-wide count either.
 *
 * A route rather than a prop on the `/map` server component: as a prop, every
 * visit to that page would pay a full-vault scan even when the reader never
 * leaves the List tab.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await resolveIdentity(request.headers);
  // The one shared 401. Authentication sits below the reason-code contract:
  // there is no identity yet to report a reason to.
  if (!identity) return unauthorized();

  // Flag-off is a hard 404, so a disabled graph leaves no reachable surface.
  if (!isKbGraphEnabled()) return fail("not_found");

  const graph = getKbGraph(vaultRootFor(identity.clearance));
  // The task overlay (spec 2026-08-17-kb-task-links-design) is composed onto a
  // copy per request, never into the cache, so a status change shows on the
  // next fetch and task writes never need to invalidate the KB cache. Both
  // halves carry never-throws contracts. No flag of its own: `TASKS_ENABLED`
  // is already the kill switch for the tasks subsystem, and with it off this
  // payload is byte-identical to before the overlay existed.
  if (isTasksEnabled()) {
    return Response.json(overlayTaskNodes(graph, listKbAnchoredTasks(getDb(), identity.clearance)));
  }
  return Response.json(graph);
}
